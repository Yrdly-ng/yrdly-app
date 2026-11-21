'use client';

import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase/supabase';

type Quote = { feeKobo: number; eta: string | null; kwik: boolean };

export function DeliveryQuotePreview({ itemId }: { itemId: string }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function requestQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const fields = new FormData(event.currentTarget);
    setQuote(null);
    setError('');
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sign in to get a delivery quote.');
      const response = await fetch('/api/marketplace/delivery-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ itemId, name: fields.get('name'), phone: fields.get('phone'), address: fields.get('address') }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Delivery quotes are temporarily unavailable.');
      setQuote(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Delivery quotes are temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border/60 p-4">
      <h2 className="text-sm font-semibold text-foreground">Delivery quote preview</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        This test shows a delivery estimate. The payment button below is for pickup.
      </p>
      <form className="mt-3" onSubmit={requestQuote} onChange={() => { setQuote(null); setError(''); }}>
        <fieldset disabled={loading} className="space-y-3">
          <label className="block text-xs text-foreground">
            Recipient name
            <input name="name" required minLength={3} maxLength={100} autoComplete="name"
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs text-foreground">
            Recipient phone
            <input name="phone" required type="tel" maxLength={15} autoComplete="tel"
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <label className="block text-xs text-foreground">
            Lagos delivery address
            <input name="address" required minLength={12} maxLength={300} autoComplete="street-address"
              className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground disabled:opacity-50">
            {loading ? 'Getting quote…' : 'Get delivery quote'}
          </button>
        </fieldset>
      </form>
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      {quote && (
        <p role="status" className="mt-3 text-sm text-foreground">
          {quote.kwik ? 'Kwik' : 'Sandbox courier'} estimate{' '}
          {new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(quote.feeKobo / 100)}
          {quote.eta && ' · ' + quote.eta}
        </p>
      )}
    </section>
  );
}
