import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../supabase/supabase-admin";
import { PaylukService } from "./payluk-service";
import { PayoutService } from "./payout-service";
import { paylukRetryAfterSeconds } from "./payluk-rate-limit";

const MAX_ATTEMPTS = 4;
const MAX_CHECKS = 8;
type AttemptResult = Awaited<ReturnType<typeof PayoutService.processPayout>>;
type RecoveryJob = {
  payout_id: string;
  lease_token: string;
  attempts: number;
  checks: number;
  action: "inspect" | "retry" | "reconcile";
  provider_debit: number | null;
  net_amount: number | null;
  provider_reference: string | null;
  attempt_reference: string | null;
};

/** Durable recovery is opt-in at new automatic reservation; never scan old payouts. */
export class AutomaticPayoutRecovery {
  private static async finish(
    job: RecoveryJob,
    action: "done" | "attention" | "retry" | "reconcile",
    delay = 300,
    error?: string,
  ) {
    const { data, error: saveError } = await supabaseAdmin.rpc(
      "finish_automatic_payout_recovery",
      {
        p_payout_id: job.payout_id,
        p_token: job.lease_token,
        p_action: action,
        p_delay_seconds: Math.ceil(Math.max(60, delay)),
        p_error: error || null,
      },
    );
    if (saveError) throw saveError;
    return data === true;
  }

  private static async readPayout(id: string) {
    const { data, error } = await supabaseAdmin
      .from("payout_requests")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) throw error || new Error("Payout not found");
    return data;
  }

  static async recordResult(
    payoutId: string,
    token: string,
    result: AttemptResult,
  ) {
    const { data: job, error } = await supabaseAdmin
      .from("automatic_payout_recovery")
      .select("*")
      .eq("payout_id", payoutId)
      .eq("lease_token", token)
      .single();
    if (error || !job)
      throw error || new Error("Recovery lease no longer owned");
    const payout = await this.readPayout(payoutId);
    if (payout.status === "completed" || payout.status === "cancelled")
      return this.finish(job, "done");
    if (
      payout.transaction_reference !==
      (payout.execution_stage === "submitted"
        ? job.provider_reference
        : job.attempt_reference)
    ) {
      return this.finish(
        job,
        "attention",
        300,
        "Payout attempt changed outside automatic recovery",
      );
    }
    if (
      payout.execution_stage === "submitted" &&
      payout.status === "processing"
    ) {
      return this.finish(
        job,
        job.checks >= MAX_CHECKS ? "attention" : "reconcile",
        300,
        "Transfer outcome requires reconciliation",
      );
    }
    if (
      payout.status === "failed" &&
      payout.execution_stage === "preparing" &&
      result.transientFailure &&
      job.attempts < MAX_ATTEMPTS
    ) {
      return this.finish(
        job,
        "retry",
        Math.max(
          result.retryAfterSeconds || 0,
          300 * 2 ** Math.max(0, job.attempts - 1),
        ),
        result.error,
      );
    }
    return this.finish(
      job,
      "attention",
      300,
      result.error || "Payout could not be completed safely",
    );
  }

  /** One globally leased job per call. This endpoint never enrolls a payout. */
  static async runOne(): Promise<{ status: string; payoutId?: string }> {
    if (process.env.AUTO_PAYOUT_RECOVERY_ENABLED !== "true")
      return { status: "disabled" };
    const token = randomUUID();
    const { data, error } = await supabaseAdmin.rpc(
      "claim_automatic_payout_recovery",
      { p_token: token },
    );
    if (error) throw error;
    if (!data) return { status: "idle" };
    const job = data as RecoveryJob;
    try {
      const payout = await this.readPayout(job.payout_id);
      if (payout.status === "completed" || payout.status === "cancelled") {
        await this.finish(job, "done");
        return { status: "done", payoutId: job.payout_id };
      }
      if (
        payout.transaction_reference !==
        (payout.execution_stage === "submitted"
          ? job.provider_reference
          : job.attempt_reference)
      ) {
        await this.finish(
          job,
          "attention",
          300,
          "Payout attempt changed outside automatic recovery",
        );
        return { status: "attention", payoutId: job.payout_id };
      }
      if (payout.execution_stage === "submitted") {
        if (
          !job.provider_reference ||
          job.provider_reference !== payout.transaction_reference
        ) {
          await this.finish(
            job,
            "attention",
            300,
            "Submitted reference changed; recovery quote no longer matches",
          );
          return { status: "attention", payoutId: job.payout_id };
        }
        // Never verify or create an intent here. Missing/multiple/unknown history
        // remains pending, and a failed bank transfer requires manual attention.
        const { data: user, error: userError } = await supabaseAdmin
          .from("users")
          .select("payluk_customer_id")
          .eq("id", payout.seller_id)
          .single();
        if (
          userError ||
          !user?.payluk_customer_id ||
          !payout.transaction_reference
        ) {
          await this.finish(
            job,
            "attention",
            300,
            "Missing reconciliation identity or reference",
          );
          return { status: "attention", payoutId: job.payout_id };
        }
        const outcome = await PaylukService.getWithdrawalStatus(
          user.payluk_customer_id,
          payout.transaction_reference,
        );
        if (outcome === "pending") {
          await this.finish(
            job,
            job.checks >= MAX_CHECKS ? "attention" : "reconcile",
            300,
            "Provider has not confirmed transfer outcome",
          );
          return {
            status: job.checks >= MAX_CHECKS ? "attention" : "reconcile",
            payoutId: job.payout_id,
          };
        }
        // Store only the exact submitted attempt. A simultaneous manual retry
        // changes its status/reference and causes this CAS to fail closed.
        const debit = Number(job.provider_debit);
        if (
          outcome === "success" &&
          (!Number.isFinite(debit) ||
            debit <= 0 ||
            debit > Number(payout.amount))
        ) {
          await this.finish(
            job,
            "attention",
            300,
            "Missing trusted withdrawal quote",
          );
          return { status: "attention", payoutId: job.payout_id };
        }
        const { data: saved, error: saveError } = await supabaseAdmin
          .from("payout_requests")
          .update({
            status: outcome === "success" ? "completed" : "failed",
            ...(outcome === "success" ? { amount: debit } : {}),
            failure_reason:
              outcome === "success"
                ? null
                : "Provider confirmed transfer failure during reconciliation",
            processed_at: new Date().toISOString(),
          })
          .eq("id", payout.id)
          .eq("status", payout.status)
          .eq("execution_stage", "submitted")
          .eq("transaction_reference", payout.transaction_reference)
          .select("id")
          .maybeSingle();
        if (saveError || !saved)
          throw saveError || new Error("Payout changed during reconciliation");
        await this.finish(
          job,
          outcome === "success" ? "done" : "attention",
          300,
          outcome === "success"
            ? undefined
            : "Provider confirmed failure; review bank details before retry",
        );
        return {
          status: outcome === "success" ? "done" : "attention",
          payoutId: job.payout_id,
        };
      }
      // Reconciliation may inspect existing submitted transfers, but never
      // requeue, reserve, create an intent, or initiate another bank withdrawal.
      await this.finish(job, "attention", 300, "Automatic payouts disabled; seller must request withdrawal.");
      return { status: "attention", payoutId: job.payout_id };
    } catch (error) {
      // A crashed job remains durable. A later claim inspects the persisted
      // stage; no exception ever authorizes another transfer by itself.
      const delay = paylukRetryAfterSeconds(error) || 300;
      await this.finish(
        job,
        job.checks >= MAX_CHECKS
          ? "attention"
          : "reconcile",
        delay,
        "Recovery check unavailable",
      );
      throw error;
    }
  }
}
