import { supabaseAdmin } from "@/lib/supabase/supabase-admin";
import type { PaylukEscrow } from "@/lib/payments/payluk-service";

/** Server configuration only; unknown/mismatched hosts never become live sales. */
export function campaignPaymentEnvironment(
  config = process.env,
): "live" | "test" | null {
  const key = config.PAYLUK_SECRET_KEY || "";
  const expected = key.startsWith("sk_live_")
    ? "https://api.payluk.ng"
    : key.startsWith("sk_test_")
      ? "https://staging.api.payluk.ng"
      : null;
  if (!expected) return null;
  try {
    const configured = new URL(config.PAYLUK_BASE_URL || expected);
    if (
      configured.origin !== expected ||
      configured.pathname !== "/" ||
      configured.search ||
      configured.hash ||
      configured.username ||
      configured.password
    )
      return null;
    return key.startsWith("sk_live_") ? "live" : "test";
  } catch {
    return null;
  }
}

async function evidenceRpc(
  name: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(name, args);
  if (error) {
    console.error(
      "[CampaignEvidence] Could not persist evidence",
      name,
      error.code,
    );
    throw new Error(
      "Campaign order evidence requires reconciliation. Please retry or contact support.",
    );
  }
  return data === true;
}

export async function captureCampaignOrder(
  transactionId: string,
): Promise<void> {
  const environment = campaignPaymentEnvironment();
  if (!environment)
    throw new Error(
      "Payment environment could not be verified. No payment has been started.",
    );
  await evidenceRpc("capture_campaign_order", {
    p_transaction_id: transactionId,
    p_environment: environment,
  });
}

export function beginCampaignReceipt(transactionId: string, buyerId: string) {
  return evidenceRpc("begin_campaign_receipt", {
    p_transaction_id: transactionId,
    p_buyer_id: buyerId,
  });
}

/** Only pass an authenticated provider response, never a request/webhook body. */
export async function finishCampaignReceipt(
  transactionId: string,
  buyerId: string,
  expectedEscrowId: string,
  escrow: PaylukEscrow,
  amount?: number,
) {
  if (
    escrow.id !== expectedEscrowId ||
    escrow.status !== "COMPLETED" ||
    escrow.state !== "CLOSED" ||
    (amount !== undefined &&
      Math.round(escrow.amount * 100) !== Math.round(amount * 100))
  )
    return false;
  const environment = campaignPaymentEnvironment();
  if (!environment) return false;
  return evidenceRpc("finish_campaign_receipt", {
    p_transaction_id: transactionId,
    p_buyer_id: buyerId,
    p_provider_escrow_id: escrow.id,
    p_provider_status: escrow.status,
    p_provider_completed_at: escrow.completedAt || null,
    p_environment: environment,
  });
}

export async function recordCampaignRefund(transactionId: string) {
  await evidenceRpc("record_campaign_refund", {
    p_transaction_id: transactionId,
  });
}
