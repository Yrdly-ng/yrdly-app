'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useBusinessBookings } from '@/hooks/use-bookings';
import { supabase } from '@/lib/supabase';

export default function BusinessBookingsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const businessId = params.businessId as string;
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [businessName, setBusinessName] = useState('');
  const { bookings, loading, refresh } = useBusinessBookings(authorized ? businessId : undefined);

  useEffect(() => {
    let active = true;
    async function checkOwner() {
      if (!businessId || authLoading) return;
      if (!user?.id) {
        if (active) setAuthorized(false);
        return;
      }
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, owner_id')
        .eq('id', businessId)
        .maybeSingle();
      if (!active) return;
      setAuthorized(!error && data?.owner_id === user.id);
      setBusinessName(data?.name || '');
    }
    void checkOwner();
    return () => { active = false; };
  }, [authLoading, businessId, user?.id]);

  const sortedBookings = [...bookings].sort((a, b) =>
    new Date(a.appointment_time).getTime() - new Date(b.appointment_time).getTime()
  );
  const requests = sortedBookings.filter((booking) => booking.status === 'requested');
  const otherBookings = sortedBookings.filter((booking) => booking.status !== 'requested');

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between gap-4 pb-6 border-b border-neutral-800">
          <div>
            <h1 className="text-2xl font-bold">Booking Requests</h1>
            <p className="text-sm text-neutral-400 mt-1">{businessName || 'Your business'}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={refresh} disabled={loading} className="px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm disabled:opacity-50">
              Refresh
            </button>
            <button onClick={() => router.push(`/businesses/${businessId}`)} className="px-3 py-2 rounded-lg bg-neutral-900 border border-neutral-800 text-sm">
              Business page
            </button>
          </div>
        </header>

        {authLoading || authorized === null ? (
          <p className="py-20 text-center text-neutral-400">Checking business access...</p>
        ) : !authorized ? (
          <div role="alert" className="mt-8 rounded-xl border border-red-500/20 bg-red-500/10 p-5 text-red-300">
            You don’t have access to this provider inbox.
          </div>
        ) : loading ? (
          <p className="py-20 text-center text-neutral-400">Loading bookings...</p>
        ) : (
          <div className="space-y-8 mt-6">
            <section>
              <h2 className="text-lg font-semibold mb-3">New requests ({requests.length})</h2>
              {requests.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {requests.map((booking) => (
                    <BookingCard key={booking.id} booking={booking} onOpen={() => router.push(`/bookings/${booking.id}`)} />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">No booking requests need a response.</p>
              )}
            </section>
            <section>
              <h2 className="text-lg font-semibold mb-3">Other bookings</h2>
              {otherBookings.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {otherBookings.map((booking) => (
                    <BookingCard key={booking.id} booking={booking} onOpen={() => router.push(`/bookings/${booking.id}`)} />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">Confirmed and past bookings will appear here.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function BookingCard({ booking, onOpen }: { booking: any; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="w-full text-left rounded-2xl border border-neutral-800 bg-neutral-900 p-5 hover:border-neutral-600 transition">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{booking.service?.name || 'Service appointment'}</p>
          <p className="text-sm text-neutral-400 mt-1">Customer: {booking.customer?.name || 'Yrdly customer'}</p>
        </div>
        <span className="rounded-full border border-neutral-700 bg-neutral-950 px-2.5 py-1 text-xs capitalize text-neutral-300">
          {String(booking.status).replaceAll('_', ' ')}
        </span>
      </div>
      <p className="mt-4 text-sm text-emerald-300">
        {new Date(booking.appointment_time).toLocaleString('en-NG', {
          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
        })}
      </p>
      {booking.notes && <p className="mt-3 line-clamp-2 text-sm text-neutral-400">{booking.notes}</p>}
      <p className="mt-4 text-xs text-neutral-500">Open to respond or view details →</p>
    </button>
  );
}
