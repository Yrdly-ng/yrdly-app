'use client';

import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase/supabase';

export type TravoQuotePreviewValue = { feeKobo: number; dropoff: string; token?: string };

export function TravoQuotePreview({ itemId, onQuote }: {
  itemId: string;
  onQuote: (quote: TravoQuotePreviewValue | null) => void;
}) {
  const [address, setAddress] = useState('');
  const [quote, setQuote] = useState<TravoQuotePreviewValue | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function fetchQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setQuote(null);
    onQuote(null);
    setError('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Sign in to get a delivery quote.');
      const response = await fetch('/api/marketplace/travo-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify({ itemId, address }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Delivery quotes are unavailable.');
      setQuote(value);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Delivery quotes are unavailable.');
    } finally { setLoading(false); }
  }

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="text-sm font-semibold">Delivery by Travo</h2>
      <p className="text-xs text-muted-foreground">You’ll pay Travo directly when the seller is ready. Travo uses your address and contact details to arrange delivery.</p>
      <form onSubmit={fetchQuote} className="space-y-2">
        <label className="block text-xs">
          Lagos delivery address
          <input required minLength={12} maxLength={300} autoComplete="street-address" disabled={loading} value={address}
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            onChange={event => { setAddress(event.target.value); setQuote(null); onQuote(null); setError(''); }} />
        </label>
        <button type="submit" disabled={loading} className="rounded-lg border border-border px-3 py-2 text-xs">
          {loading ? 'Getting quote…' : 'Get delivery quote'}
        </button>
      </form>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {quote && (
        <div className="space-y-2 text-sm">
          <p role="status">Delivery fee: ₦{(quote.feeKobo / 100).toLocaleString()} · {quote.dropoff}</p>
          {quote.token ? (
            <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs" onClick={() => onQuote(quote)}>
              Confirm address and delivery fee
            </button>
          ) : <p className="text-xs text-muted-foreground">This quote is for preview only.</p>}
        </div>
      )}
    </section>
  );
}
