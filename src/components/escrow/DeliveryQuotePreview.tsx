'use client';

import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase/supabase';

export type Quote = { feeKobo: number; eta: string | null; kwik: boolean; token?: string };

export function DeliveryQuotePreview({ itemId, onQuoteChange }: { itemId: string; onQuoteChange: (quote: Quote | null) => void }) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function requestQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const fields = new FormData(event.currentTarget);
    setQuote(null);
    onQuoteChange(null);
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
      onQuoteChange(result.token ? result : null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Delivery quotes are temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border/60 p-4">
      <h2 className="text-sm font-semibold text-foreground">Lagos delivery quote</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        We share the recipient’s details with our delivery partner to get a quote.
      </p>
      <form className="mt-3" onSubmit={requestQuote} onChange={() => { setQuote(null); onQuoteChange(null); setError(''); }}>
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
        <div className="mt-3 space-y-2">
          <p role="status" className="text-sm text-foreground">
            {quote.kwik ? 'Kwik' : 'Sandbox courier'} estimate{' '}
            {new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(quote.feeKobo / 100)}
            {quote.eta && ' · ' + quote.eta}
          </p>
        </div>
      )}
    </section>
  );
}
