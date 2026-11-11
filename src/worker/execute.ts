import type { Pool } from "pg";
import { completeJob, failJob, type Job } from "./claims";

export type Reconciliation = { outcome: "completed"; reference: string | null } | { outcome: "not_sent" } | { outcome: "unknown" };
export type JobHandler = { execute(job: Job): Promise<string | null>; reconcile(job: Job): Promise<Reconciliation> };
export async function executeLeasedJob(database: Pool, job: Job, handler: JobHandler): Promise<"completed" | "reconciliation" | "lease_lost"> {
  try {
    if (job.attempt_count > 1) {
      const prior = await handler.reconcile(job);
      if (prior.outcome === "completed") {
        await completeJob(database, job, prior.reference);
        return "completed";
      }
      if (prior.outcome === "unknown") {
        await failJob(database, job, "PROVIDER_OUTCOME_UNKNOWN", true);
        return "reconciliation";
      }
      // Only positive evidence that nothing was sent permits another dispatch.
    }
    const reference = await handler.execute(job);
    await completeJob(database, job, reference);
    return "completed";
  } catch (error) {
    if (isLeaseLost(error)) return "lease_lost";
    try {
      // A generic failure may follow an accepted provider request. Never retry blindly.
      await failJob(database, job, "HANDLER_OUTCOME_UNKNOWN", true);
      return "reconciliation";
    } catch (failure) {
      if (isLeaseLost(failure)) return "lease_lost";
      throw failure;
    }
  }
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof Error && error.message === "LEASE_LOST";
}
