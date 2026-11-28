import type { Pool } from "pg";
import { completeJob, failJob, failJobExecution, startJobDispatch, type Job } from "./claims";

export type Reconciliation = { outcome: "completed"; reference: string | null } | { outcome: "not_sent" } | { outcome: "unknown" };
/** A domain delivery can retain uncertainty from a previous, separately queued send. */
export class ProviderOutcomeUnknown extends Error {}
export type JobHandler = {
  /** Delivery handlers fence the actual send after preparing the recipient and content. */
  marksProviderDispatch?: true;
  execute(job: Job): Promise<string | null>;
  reconcile(job: Job): Promise<Reconciliation>;
};
export async function executeLeasedJob(database: Pool, job: Job, handler: JobHandler): Promise<"completed" | "pending" | "failed" | "reconciliation" | "lease_lost"> {
  try {
    if (job.requires_reconciliation ?? job.attempt_count > 1) {
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
    if (!handler.marksProviderDispatch) await startJobDispatch(database, job);
    const reference = await handler.execute(job);
    await completeJob(database, job, reference);
    return "completed";
  } catch (error) {
    if (isLeaseLost(error)) return "lease_lost";
    try {
      if (error instanceof ProviderOutcomeUnknown) {
        await failJob(database, job, "PROVIDER_OUTCOME_UNKNOWN", true);
        return "reconciliation";
      }
      return await failJobExecution(database, job);
    } catch (failure) {
      if (isLeaseLost(failure)) return "lease_lost";
      throw failure;
    }
  }
}

function isLeaseLost(error: unknown): boolean {
  return error instanceof Error && error.message === "LEASE_LOST";
}
