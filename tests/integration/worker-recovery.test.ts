import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDatabasePool } from "../../src/server/database";
import { claimJobs, claimWorkerJobs, startJobDispatch } from "../../src/worker/claims";
import { executeLeasedJob, type JobHandler } from "../../src/worker/execute";
import { assertTestDatabase, localDatabaseUrl, testDatabaseUrl } from "../helpers/environment";

const database = createDatabasePool(testDatabaseUrl());
const workerA = createDatabasePool(localDatabaseUrl("gittutor_test", true));
const workerB = createDatabasePool(localDatabaseUrl("gittutor_test", true));
beforeAll(() => assertTestDatabase(database));
afterAll(() => Promise.all([database.end(), workerA.end(), workerB.end()]));
async function enqueue(purpose: string) {
  const event = randomUUID();
  return (await database.query("select app_private.enqueue_event($1,'recovery_test',$1,'{}',$2) id", [event, purpose])).rows[0].id as string;
}
async function expire(id: string) {
  await database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [id]);
}

test.each(["manual", "fake", "cloud"] as const)("a busy %s worker leaves the second job available and an untouched expired claim sends once", async mode => {
  const purpose = randomUUID();
  const slow = await enqueue(purpose);
  await database.query("update app_private.outbox_jobs set available_at=now()-interval '1 day' where id=$1", [slow]);
  const next = await enqueue(purpose);
  const claimed = await claimWorkerJobs(workerA, purpose, mode);
  expect(claimed.map(job => job.id)).toEqual([slow]);
  let notifyStarted!: () => void;
  let finishSend!: () => void;
  const entered = new Promise<void>(resolve => { notifyStarted = resolve; });
  const release = new Promise<void>(resolve => { finishSend = resolve; });
  const sent: string[] = [];
  const handler: JobHandler = {
    execute: async job => {
      sent.push(job.id);
      if (job.id === slow) { notifyStarted(); await release; }
      return job.id;
    },
    reconcile: async () => ({ outcome: "unknown" }),
  };
  const processing = executeLeasedJob(workerA, claimed[0], handler);
  try {
    await Promise.race([entered, processing.then(result => { throw new Error("Slow send ended early: " + result); })]);
    const untouched = (await claimWorkerJobs(workerB, purpose, mode))[0];
    expect(untouched.id).toBe(next);
    await expire(next); // This worker crashed before dispatching the second job.
    const replacement = (await claimWorkerJobs(workerB, purpose, mode))[0];
    expect(await executeLeasedJob(workerB, untouched, handler)).toBe("lease_lost");
    expect(await executeLeasedJob(workerB, replacement, handler)).toBe("completed");
    await expire(slow); // The recording provider accepted this send, but has not returned.
    const recovery = (await claimWorkerJobs(workerB, purpose, mode))[0];
    await expire(slow); // An additional crash during recovery must retain the original uncertainty.
    const finalLease = (await claimWorkerJobs(workerB, purpose, mode))[0];
    expect(finalLease.lease_token).not.toBe(recovery.lease_token);
    expect(await executeLeasedJob(workerB, finalLease, handler)).toBe("reconciliation");
    expect(sent).toEqual([slow, next]);
    expect(await claimWorkerJobs(workerB, purpose, mode)).toEqual([]);
  } finally {
    finishSend();
    await processing;
  }
  expect(await processing).toBe("lease_lost");
});

test("a new worker reconciles expired claims made by an older worker", async () => {
  const first = await leased();
  await expire(first.id);
  const [reclaimed] = await claimWorkerJobs(workerB, first.purpose, "fake");
  let sends = 0;
  const result = await executeLeasedJob(workerB, reclaimed, {
    execute: async () => { sends++; return "duplicate"; },
    reconcile: async () => ({ outcome: "unknown" }),
  });
  expect(result).toBe("reconciliation");
  expect(sends).toBe(0);
});

test("the final allowed lease can recover untouched work and parks a started dispatch", async () => {
  const purpose = randomUUID();
  const id = await enqueue(purpose);
  await database.query('update app_private.outbox_jobs set max_attempts=1 where id=$1', [id]);
  const [untouched] = await claimWorkerJobs(workerA, purpose, "fake");
  await expire(id);
  const [last] = await claimWorkerJobs(workerB, purpose, "fake");
  expect(last.requires_reconciliation).toBe(false);
  await expect(startJobDispatch(workerA, untouched)).rejects.toThrow("LEASE_LOST");
  await startJobDispatch(workerB, last);
  await expire(id);
  expect(await claimWorkerJobs(workerA, purpose, "fake")).toEqual([]);
  expect((await database.query('select state,last_error_code from app_private.outbox_jobs where id=$1', [id])).rows[0])
    .toEqual({ state: "reconciliation", last_error_code: "PROVIDER_OUTCOME_UNKNOWN" });
});

test("preparation failure retries a tracked send while preserving ambiguous legacy attempts", async () => {
  const purpose = randomUUID();
  const id = await enqueue(purpose);
  const handler: JobHandler = {
    marksProviderDispatch: true,
    execute: async () => { throw new Error("Synthetic preparation failure"); },
    reconcile: async () => ({ outcome: "unknown" }),
  };
  const [tracked] = await claimWorkerJobs(workerA, purpose, "fake");
  expect(await executeLeasedJob(workerA, tracked, handler)).toBe("pending");
  const retry = await database.query("select state,available_at>now() delayed from app_private.outbox_jobs where id=$1", [id]);
  expect(retry.rows[0]).toEqual({ state: "pending", delayed: true });
  const legacy = await leased();
  expect(await executeLeasedJob(workerB, legacy, handler)).toBe("reconciliation");
});
async function leased() {
  const id = randomUUID();
  await database.query("select app_private.enqueue_event($1,'recovery_test',$1,'{}',$2)", [id, id]);
  return (await claimJobs(database, id, 1))[0];
}

test("reclaimed lease reconciles a successful external action before redispatch", async () => {
  const first = await leased();
  // Simulate process loss after a provider accepted the stable event identity.
  const external = new Map([[first.event_id, "fake:existing-provider-result"]]);
  await database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first.id]);
  const reclaimed = (await claimJobs(database, first.purpose, 1))[0];
  let sends = 0;
  const handler: JobHandler = {
    execute: async () => { sends++; return "fake:duplicate"; },
    reconcile: async job => ({ outcome: "completed", reference: external.get(job.event_id)! }),
  };
  expect(await executeLeasedJob(database, reclaimed, handler)).toBe("completed");
  expect(sends).toBe(0);
  const row = (await database.query("select state,provider_reference from app_private.outbox_jobs where id=$1", [first.id])).rows[0];
  expect(row).toEqual({ state: "completed", provider_reference: "fake:existing-provider-result" });
});

test("unknown recovered outcome is parked without another provider call", async () => {
  const first = await leased();
  await database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first.id]);
  const reclaimed = (await claimJobs(database, first.purpose, 1))[0];
  let sends = 0;
  expect(await executeLeasedJob(database, reclaimed, {
    execute: async () => { sends++; return "fake:duplicate"; },
    reconcile: async () => ({ outcome: "unknown" }),
  })).toBe("reconciliation");
  expect(sends).toBe(0);
  expect(await claimJobs(database, first.purpose, 1)).toEqual([]);
});

test("a stale worker acknowledgment does not crash or overwrite a successor lease", async () => {
  const first = await leased();
  let successorToken = "";
  const result = await executeLeasedJob(database, first, {
    execute: async () => {
      await database.query("update app_private.outbox_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [first.id]);
      successorToken = (await claimJobs(database, first.purpose, 1))[0].lease_token;
      return "fake:completed-after-lease-loss";
    },
    reconcile: async () => ({ outcome: "not_sent" }),
  });
  expect(result).toBe("lease_lost");
  const row = (await database.query("select state,lease_token from app_private.outbox_jobs where id=$1", [first.id])).rows[0];
  expect(row).toEqual({ state: "leased", lease_token: successorToken });
});
