import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createDatabasePool } from "../../src/server/database";
import { claimJobs } from "../../src/worker/claims";
import { executeLeasedJob, type JobHandler } from "../../src/worker/execute";
import { assertTestDatabase, testDatabaseUrl } from "../helpers/environment";

const database = createDatabasePool(testDatabaseUrl());
beforeAll(() => assertTestDatabase(database));
afterAll(() => database.end());
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
