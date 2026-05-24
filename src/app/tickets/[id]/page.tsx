'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, MapPin, Calendar, Clock, Download } from 'lucide-react';
import Image from 'next/image';

interface Ticket {
  id: string;
  status: string;
  attendee_name: string;
  attendee_email: string;
  amount_paid: number;
  created_at: string;
  scanned_at: string | null;
  event: {
    id: string;
    title: string;
    cover_image_url: string;
    start_time: string;
    end_time: string;
    location_address: string;
    location_online: boolean;
    online_link: string;
    status: string;
    lga: string;
    state: string;
  };
  tier: {
    id: string;
    name: string;
    price: number;
    description: string;
  };
}

export default function TicketPage() {
  const params = useParams();
  const ticketId = params.id as string;
  
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTicket = async () => {
      try {
        const response = await fetch(`/api/tickets/${ticketId}`);
        if (!response.ok) {
          throw new Error('Ticket not found');
        }
        const data = await response.json();
        setTicket(data.ticket);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load ticket');
      } finally {
        setLoading(false);
      }
    };

    fetchTicket();
  }, [ticketId]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-green-600 animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600">Loading your ticket...</p>
        </div>
      </div>
    );
  }

  if (error || !ticket) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-6xl mb-4">🎟️</div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Ticket Not Found</h1>
          <p className="text-slate-600 mb-6">
            {error || 'We couldn\'t find this ticket. It may have been deleted or the link is invalid.'}
          </p>
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 bg-green-600 text-white px-6 py-2 rounded-lg hover:bg-green-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  const eventDate = new Date(ticket.event.start_time);
  const eventEndDate = new Date(ticket.event.end_time);
  const eventTime = eventDate.toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true });
  const eventDateStr = eventDate.toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const ticketCreatedDate = new Date(ticket.created_at);

  const isScanned = ticket.scanned_at !== null;
  const isEventPast = eventEndDate < new Date();

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 py-4 sm:py-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-green-600 hover:text-green-700 mb-4 font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-900">Your Ticket</h1>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12">
        {/* Status Badge */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-full">
            <div className="w-2 h-2 bg-green-600 rounded-full"></div>
            <span className="text-sm font-medium text-green-700">
              {isScanned ? 'Used - Thank you!' : 'Valid'}
            </span>
          </div>
        </div>

        {/* Ticket Card */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-8">
          {/* Event Cover Image */}
          {ticket.event.cover_image_url && (
            <div className="relative h-48 sm:h-64 bg-gradient-to-br from-slate-200 to-slate-300">
              <Image
                src={ticket.event.cover_image_url}
                alt={ticket.event.title}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 768px"
              />
            </div>
          )}

          {/* Ticket Details */}
          <div className="p-6 sm:p-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-6">{ticket.event.title}</h2>

            {/* Event Details Grid */}
            <div className="grid sm:grid-cols-2 gap-6 mb-8">
              <div className="flex gap-3">
                <Calendar className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                <div>
                  <p className="text-sm text-slate-600 font-medium">Date</p>
                  <p className="text-slate-900 font-semibold">{eventDateStr}</p>
                </div>
              </div>

              <div className="flex gap-3">
                <Clock className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                <div>
                  <p className="text-sm text-slate-600 font-medium">Time</p>
                  <p className="text-slate-900 font-semibold">{eventTime}</p>
                </div>
              </div>

              <div className="flex gap-3 sm:col-span-2">
                <MapPin className="w-5 h-5 text-green-600 flex-shrink-0 mt-1" />
                <div>
                  <p className="text-sm text-slate-600 font-medium">Location</p>
                  <p className="text-slate-900 font-semibold">
                    {ticket.event.location_online
                      ? ticket.event.online_link || 'Online Event'
                      : ticket.event.location_address || `${ticket.event.lga}, ${ticket.event.state}`}
                  </p>
                </div>
              </div>
            </div>

            <hr className="my-8" />

            {/* Ticket Information */}
            <div className="space-y-4 mb-8">
              <div>
                <p className="text-sm text-slate-600 font-medium mb-1">Ticket Type</p>
                <p className="text-lg font-semibold text-slate-900">{ticket.tier.name}</p>
              </div>

              <div>
                <p className="text-sm text-slate-600 font-medium mb-1">Attendee</p>
                <p className="text-lg font-semibold text-slate-900">{ticket.attendee_name}</p>
              </div>

              {ticket.tier.description && (
                <div>
                  <p className="text-sm text-slate-600 font-medium mb-1">Details</p>
                  <p className="text-slate-700">{ticket.tier.description}</p>
                </div>
              )}

              <div>
                <p className="text-sm text-slate-600 font-medium mb-1">Ticket ID</p>
                <p className="text-slate-900 font-mono text-sm bg-slate-50 p-3 rounded border border-slate-200">{ticket.id}</p>
              </div>

              {ticket.amount_paid > 0 && (
                <div>
                  <p className="text-sm text-slate-600 font-medium mb-1">Amount Paid</p>
                  <p className="text-lg font-semibold text-slate-900">₦{ticket.amount_paid.toLocaleString('en-NG')}</p>
                </div>
              )}

              {ticket.amount_paid === 0 && (
                <div>
                  <p className="text-sm text-slate-600 font-medium mb-1">Ticket Type</p>
                  <p className="text-lg font-semibold text-green-600">Free Ticket</p>
                </div>
              )}

              <div>
                <p className="text-sm text-slate-600 font-medium mb-1">Purchased</p>
                <p className="text-slate-700">
                  {ticketCreatedDate.toLocaleDateString('en-NG', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>

              {isScanned && ticket.scanned_at && (
                <div>
                  <p className="text-sm text-slate-600 font-medium mb-1">Scanned</p>
                  <p className="text-slate-700">
                    {new Date(ticket.scanned_at).toLocaleDateString('en-NG', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              )}
            </div>

            {/* Message */}
            {!isScanned && !isEventPast && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-8">
                <p className="text-blue-900 text-sm">
                  📱 <strong>Have this ticket ready at the entrance</strong> — Show your phone or print it out. The event staff will scan your ticket code.
                </p>
              </div>
            )}

            {isScanned && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-8">
                <p className="text-green-900 text-sm">
                  ✅ <strong>Thank you for attending!</strong> Your ticket has been scanned.
                </p>
              </div>
            )}

            {isEventPast && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-8">
                <p className="text-slate-700 text-sm">
                  📅 This event has already passed. Hope you enjoyed it!
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-6 py-2 rounded-lg hover:bg-slate-50 transition-colors font-medium"
          >
            <Download className="w-4 h-4" />
            Print Ticket
          </button>
        </div>

        {/* Support */}
        <div className="mt-12 text-center text-slate-600 text-sm">
          <p>Questions about your ticket?</p>
          <Link href="mailto:support@yrdly.ng" className="text-green-600 hover:text-green-700 font-medium">
            Contact Support
          </Link>
        </div>
      </div>
    </div>
  );
}
