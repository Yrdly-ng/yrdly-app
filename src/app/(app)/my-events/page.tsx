"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Plus, Calendar, MapPin, Users, QrCode, Settings } from "lucide-react";
import { getOrganizerEvents } from "@/lib/event-service";
import { useAuth } from "@/hooks/use-supabase-auth";

const FONT = "var(--font-work-sans)";
const RALEWAY = "var(--font-jersey25)";

export default function MyEventsPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<"upcoming" | "past">("upcoming");
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMyEvents = useCallback(async () => {
    if (!user) return;
    setLoading(true);

    try {
      const data = await getOrganizerEvents(user.id);
      setEvents(data || []);
    } catch (err) {
      console.error("Error fetching my events:", err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchMyEvents();
  }, [fetchMyEvents]);

  const now = new Date();
  const filteredEvents = events.filter((evt) => {
    const evtDate = new Date(evt.start_time || evt.created_at);
    return activeTab === "upcoming" ? evtDate >= now : evtDate < now;
  });

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/40 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-card transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-foreground" />
          </button>
          <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: RALEWAY }}>
            My Organized Events
          </h1>
        </div>

        <button
          onClick={() => router.push("/events/create")}
          className="px-3.5 py-2 rounded-full bg-primary text-primary-foreground font-bold text-xs flex items-center gap-1.5 shadow"
          style={{ fontFamily: FONT }}
        >
          <Plus className="w-4 h-4" /> Create Event
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="flex bg-card p-1 rounded-xl border border-border/40">
          <button
            onClick={() => setActiveTab("upcoming")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "upcoming"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            Upcoming Events
          </button>
          <button
            onClick={() => setActiveTab("past")}
            className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "past"
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={{ fontFamily: FONT }}
          >
            Past Events
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="py-12 flex justify-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="py-12 text-center bg-card rounded-2xl border border-border/40 text-muted-foreground space-y-2">
            <Calendar className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
            <p className="font-semibold text-sm" style={{ fontFamily: FONT }}>
              No {activeTab} events organized
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredEvents.map((evt) => (
              <div
                key={evt.id}
                className="rounded-2xl bg-card border border-border/40 p-4 space-y-4 shadow-sm"
              >
                <div className="flex gap-4">
                  <div className="relative w-24 h-24 rounded-xl bg-muted overflow-hidden shrink-0">
                    {evt.cover_image || evt.image_url ? (
                      <Image src={evt.cover_image || evt.image_url} alt={evt.title || "Event"} fill className="object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                        No Image
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-1">
                    <h3 className="font-bold text-lg text-foreground truncate" style={{ fontFamily: RALEWAY }}>
                      {evt.title}
                    </h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-1" style={{ fontFamily: FONT }}>
                      <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
                      {new Date(evt.start_time || evt.created_at).toLocaleDateString(undefined, {
                        dateStyle: "medium",
                      })}
                    </p>
                    {evt.location && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 truncate" style={{ fontFamily: FONT }}>
                        <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                        {evt.location}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground flex items-center gap-1" style={{ fontFamily: FONT }}>
                      <Users className="w-3.5 h-3.5 text-primary shrink-0" />
                      {evt.attendees_count || 0} attending
                    </p>
                  </div>
                </div>

                <div className="pt-3 border-t border-border/40 flex items-center justify-end gap-3">
                  <button
                    onClick={() => router.push(`/events/${evt.id}/scan`)}
                    className="px-3.5 py-2 rounded-xl border border-border/60 bg-background text-foreground text-xs font-bold hover:bg-muted transition-colors flex items-center gap-1.5"
                    style={{ fontFamily: FONT }}
                  >
                    <QrCode className="w-4 h-4 text-primary" /> Scan Tickets
                  </button>
                  <button
                    onClick={() => router.push(`/events/${evt.id}/manage`)}
                    className="px-3.5 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-all flex items-center gap-1.5"
                    style={{ fontFamily: FONT }}
                  >
                    <Settings className="w-4 h-4" /> Manage Event
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
