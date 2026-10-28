"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Bank = { code: string; name: string };
type Earnings = {
  enabled?: boolean;
  domain: "test" | "live";
  totals: { grossKobo: number; commissionKobo: number; providerFeeKobo: number; heldKobo: number; availableKobo: number; withdrawnKobo: number };
  withdrawals: Array<{ id: string; status: string; amount_kobo?: number; amountKobo?: number; created_at?: string }>;
};
const money = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function EventPaystackEarnings({ eventId }: { eventId: string }) {
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [resolved, setResolved] = useState<{ name: string; bankCode: string; accountNumber: string } | null>(null);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const load = useCallback(async () => {
    try {
      const data = await authenticatedFetch<Earnings>(`/api/events/${eventId}/earnings?refresh=true`, undefined, "GET");
      setEarnings(data);
      setError("");
    } catch { setError("Ticket earnings could not be loaded. Please refresh before withdrawing."); }
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  const loadBanks = async () => {
    setBusy(true);
    setError("");
    try {
      const data = await authenticatedFetch<{ banks: Bank[] }>("/api/events/banks", undefined, "GET");
      setBanks(data.banks);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not load banks."); }
    finally { setBusy(false); }
  };
  const resolve = async () => {
    setBusy(true);
    setResolved(null);
    setError("");
    try {
      const data = await authenticatedFetch<{ account: { account_name: string; account_number: string } }>(`/api/events/banks?account_number=${accountNumber}&bank_code=${encodeURIComponent(bankCode)}`, undefined, "GET");
      if (!data.account?.account_name || data.account.account_number !== accountNumber) throw new Error("The bank account could not be verified.");
      setResolved({ name: data.account.account_name, bankCode, accountNumber });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Bank verification failed."); }
    finally { setBusy(false); }
  };
  const withdraw = async () => {
    if (!earnings || !resolved || submitting.current || earnings.domain !== "test") return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await authenticatedFetch(`/api/events/${eventId}/earnings/withdraw`, {
        bankCode: resolved.bankCode, accountNumber: resolved.accountNumber,
        expectedAmountKobo: earnings.totals.availableKobo, confirm: true,
      });
      setMessage("Sandbox transfer requested. No real money is sent. Check the transfer status below.");
      setResolved(null);
      await load();
    } catch (failure) {
      await load();
      setError(failure instanceof Error ? failure.message : "Transfer outcome is pending. Refresh the history before trying again.");
    } finally { submitting.current = false; setBusy(false); }
  };

  if (earnings?.enabled === false) return null;
  if (!earnings) return error ? <div className="rounded-2xl border border-border p-5"><p role="status">{error}</p><Button variant="outline" onClick={() => void load()}>Refresh earnings</Button></div> : null;
  const { totals } = earnings;
  if (earnings.domain !== "test" && totals.grossKobo === 0) return null;
  return (
    <section className="rounded-3xl border border-border bg-card p-5 sm:p-6 space-y-5" aria-label="Paystack ticket earnings">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="text-xl font-bold">Ticket earnings</h2><p className="text-sm text-muted-foreground">{earnings.domain === "test" ? "Paystack sandbox · no real money" : "Paystack ticket collections"}</p></div>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>Refresh</Button>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[["Available", totals.availableKobo], ["Held", totals.heldKobo], ["Withdrawn", totals.withdrawnKobo], ["Ticket sales", totals.grossKobo], ["Yrdly commission", totals.commissionKobo], ["Payment fees", totals.providerFeeKobo]].map(([label, value]) => (
          <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-semibold mt-1">{money(Number(value))}</dd></div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">Proceeds become available no earlier than 24 hours after your event ends, after payment settlement and refund or dispute checks. Withdrawals require your request.</p>
      {earnings.domain === "test" && totals.availableKobo > 0 && (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="font-semibold">Try a sandbox withdrawal</h3>
          {!banks.length ? <Button disabled={busy} onClick={() => void loadBanks()}>Choose withdrawal bank</Button> : (
            <>
              <label className="block text-sm">Bank<select value={bankCode} disabled={busy} onChange={event => { setBankCode(event.target.value); setResolved(null); }} className="mt-2 w-full rounded-lg border border-border bg-background p-3"><option value="">Select bank</option>{banks.map(bank => <option key={bank.code} value={bank.code}>{bank.name}</option>)}</select></label>
              <label className="block text-sm">Account number<Input className="mt-2" value={accountNumber} disabled={busy} inputMode="numeric" maxLength={10} autoComplete="off" onChange={event => { setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10)); setResolved(null); }} /></label>
              <Button variant="outline" disabled={busy || !bankCode || accountNumber.length !== 10} onClick={() => void resolve()}>Verify account</Button>
            </>
          )}
          {resolved && <div className="rounded-xl bg-muted p-4 space-y-3"><p className="font-semibold">{resolved.name}</p><p className="text-sm">{banks.find(bank => bank.code === resolved.bankCode)?.name} · {resolved.accountNumber}</p><p>Sandbox transfer: {money(totals.availableKobo)}</p><p className="text-sm text-muted-foreground">No real money will be sent. Yrdly covers transfer fees in sandbox.</p><Button disabled={busy} onClick={() => void withdraw()}>{busy ? "Requesting…" : "Confirm sandbox withdrawal"}</Button></div>}
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      {earnings.withdrawals?.length > 0 && <div className="space-y-2"><h3 className="font-semibold">Transfer history</h3>{earnings.withdrawals.map(item => <div key={item.id} className="flex justify-between gap-3 border-t border-border py-3 text-sm"><span>{money(Number(item.amount_kobo ?? item.amountKobo ?? 0))}</span><span className="capitalize">{item.status.replace(/_/g, " ")}</span></div>)}</div>}
    </section>
  );
}
