import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { ProviderOutcomeUnknown, type JobHandler } from "./execute";
import { startJobDispatch } from "./claims";

type Delivery = {
  invitation_id: string; email: string; delivery_version: number;
  delivery_state: string; provider_user_id: string | null; reconciled_user_id: string | null;
};

function invitationProvider() {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    if (!["development", "test"].includes(process.env.APP_ENV ?? "development")) throw new Error("AUTH_PROVIDER_CONFIGURATION_REQUIRED");
    const local = JSON.parse(readFileSync(resolve(".local/supabase.json"), "utf8")) as { marker: string; url: string; secret_key: string };
    if (local.marker !== "git-tutor-supabase-local-v1" || local.url !== "http://127.0.0.1:54321") throw new Error("AUTH_PROVIDER_CONFIGURATION_REQUIRED");
    url = local.url; key = local.secret_key;
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** Auth owns invitation tokens; this worker only dispatches a durable, approved intent. */
export function staffInvitationHandler(database: Pool): JobHandler {
  const read = async (id: string): Promise<Delivery | null> => {
    const result = await database.query("select app_private.get_staff_invitation_delivery($1) as delivery", [id]);
    return result.rows[0].delivery;
  };
  const record = async (delivery: Delivery, outcome: string, userId: string | null, error: string | null = null) => {
    await database.query("select app_private.record_staff_invitation_delivery($1,$2,$3,$4,$5)", [delivery.invitation_id, delivery.delivery_version, outcome, userId, error]);
  };
  return {
    marksProviderDispatch: true,
    async execute(job) {
      const delivery = await read(job.aggregate_id);
      if (!delivery) return "suppressed:invitation_unavailable";
      if (delivery.delivery_state === "sent" && delivery.provider_user_id) return delivery.provider_user_id;
      if (delivery.delivery_state === "unknown") {
        const knownUser = delivery.provider_user_id || delivery.reconciled_user_id;
        if (!knownUser) throw new ProviderOutcomeUnknown("AUTH_INVITATION_OUTCOME_UNKNOWN");
        await record(delivery, "sent", knownUser);
        return knownUser;
      }
      const provider = invitationProvider();
      const options = { data: { staff_invitation_id: delivery.invitation_id }, redirectTo: new URL("/auth/callback", process.env.APP_BASE_URL || "http://127.0.0.1:3000").href };
      await startJobDispatch(database, job);
      const { data, error } = await provider.auth.admin.inviteUserByEmail(delivery.email, options);
      if (error || !data.user) {
        await record(delivery, "unknown", null, "AUTH_INVITATION_OUTCOME_UNKNOWN");
        throw new Error("AUTH_INVITATION_OUTCOME_UNKNOWN");
      }
      await record(delivery, "sent", data.user.id);
      return data.user.id;
    },
    async reconcile(job) {
      const delivery = await read(job.aggregate_id);
      if (!delivery) return { outcome: "completed", reference: "suppressed:invitation_unavailable" };
      const userId = delivery.provider_user_id || delivery.reconciled_user_id;
      if (userId) {
        if (delivery.delivery_state !== "sent") await record(delivery, "sent", userId);
        return { outcome: "completed", reference: userId };
      }
      // Absence of a matching Auth user is not proof that a timed-out send never happened.
      if (delivery.delivery_state !== "unknown") await record(delivery, "unknown", null, "AUTH_INVITATION_OUTCOME_UNKNOWN");
      return { outcome: "unknown" };
    },
  };
}
