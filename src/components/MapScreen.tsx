"use client";

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Search, Navigation, Calendar, Briefcase, Users } from 'lucide-react';
import { APIProvider, Map, AdvancedMarker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-supabase-auth';

type FilterTab = 'all' | 'events' | 'businesses' | 'friends';

type MarkerData = {
  id: string;
  type: 'event' | 'business' | 'friend';
  position: { lat: number; lng: number };
  title: string;
  address: string;
  description?: string;
  date?: string;
  time?: string;
  attendees?: number;
  avatar_url?: string;
  last_seen?: string;
  image?: string;
  category?: string;
  distance?: string;
};

const DARK_MAP_STYLES = [
  { featureType: "all",           elementType: "geometry",          stylers: [{ color: "var(--c-card)" }] },
  { featureType: "water",         elementType: "geometry",          stylers: [{ color: "var(--c-bg)" }] },
  { featureType: "road",          elementType: "geometry",          stylers: [{ color: "var(--c-card2)" }] },
  { featureType: "road",          elementType: "geometry.stroke",   stylers: [{ color: "var(--c-card)" }] },
  { featureType: "poi",           elementType: "labels",            stylers: [{ visibility: "off" }] },
  { featureType: "administrative",elementType: "labels.text.fill",  stylers: [{ color: "var(--c-text-muted)" }] },
  { featureType: "administrative",elementType: "labels.text.stroke",stylers: [{ color: "var(--c-bg)" }] },
  { featureType: "landscape",     elementType: "geometry",          stylers: [{ color: "var(--c-bg)" }] },
  { featureType: "transit",       elementType: "labels",            stylers: [{ visibility: "off" }] },
];

// Nigeria geographic center — neutral fallback when geolocation is unavailable
const NIGERIA_CENTER = { lat: 9.082, lng: 8.6753 };

// Inner component — must live inside <APIProvider> to use useMap()
function RecenterButton({ coords }: { coords: { lat: number; lng: number } | null }) {
  const map = useMap();
  const recenter = useCallback(() => {
    if (!map) return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); map.setZoom(14); },
        () => { if (coords) { map.panTo(coords); map.setZoom(12); } }
      );
    } else if (coords) {
      map.panTo(coords); map.setZoom(12);
    }
  }, [map, coords]);

  return (
    <button
      onClick={recenter}
      className="absolute right-6 z-20 w-14 h-14 rounded-full shadow-2xl flex items-center justify-center text-foreground transition-transform active:scale-90"
      style={{ bottom: 176, background: '#388E3C' }}
    >
      <Navigation className="w-6 h-6" />
    </button>
  );
}

interface MapScreenProps { className?: string }

export function MapScreen({ className }: MapScreenProps) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [markers, setMarkers]           = useState<MarkerData[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState<MarkerData | null>(null);
  const [search, setSearch]             = useState('');
  const [activeTab, setActiveTab]       = useState<FilterTab>('all');
  const [nearbyEvents, setNearbyEvents] = useState(0);
  const [nearbyBiz, setNearbyBiz]       = useState(0);
  const [nearbyFriends, setNearbyFriends] = useState(0);
  const [userCoords, setUserCoords]     = useState<{ lat: number; lng: number } | null>(null);

  // Get device location on mount
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {} // silently fall back to NIGERIA_CENTER
      );
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const found: MarkerData[] = [];

      const extract = (loc: any): { lat: number; lng: number; address: string } | null => {
        if (!loc) return null;
        if (loc.geopoint)            return { lat: loc.geopoint.latitude,  lng: loc.geopoint.longitude, address: loc.address || '' };
        if (loc.latitude && loc.longitude) return { lat: loc.latitude, lng: loc.longitude, address: loc.address || '' };
        if (loc.lat && loc.lng)      return { lat: loc.lat, lng: loc.lng, address: loc.address || '' };
        return null;
      };

      const userState = profile?.location?.state;

      let evtsQuery = supabase.from('posts').select('*').eq('category', 'Event').not('event_location', 'is', null);
      if (userState) evtsQuery = evtsQuery.eq('state', userState);
      const { data: evts } = await evtsQuery;
      (evts || []).forEach(p => {
        const loc = extract(typeof p.event_location === 'string' ? null : p.event_location);
        if (loc) found.push({ id: p.id, type: 'event', position: loc, title: p.title || p.text, address: loc.address || 'Location TBD', description: p.text, date: p.event_date, time: p.event_time, attendees: p.attendees?.length || 0, image: p.image_urls?.[0] });
      });

      let bizsQuery = supabase.from('businesses').select('*').not('location', 'is', null);
      if (userState) bizsQuery = bizsQuery.eq('state', userState);
      const { data: bizs } = await bizsQuery;
      (bizs || []).forEach(b => {
        const loc = extract(b.location);
        if (loc) found.push({ id: b.id, type: 'business', position: loc, title: b.name, address: loc.address || 'Lagos, Nigeria', description: b.description, category: b.category, image: b.image_urls?.[0] });
      });

      if (user?.id) {
        const { data: frds } = await supabase.rpc('get_friends_locations', { user_id: user.id });
        (frds || []).forEach((f: any) => {
          const loc = extract(f.location);
          if (loc) found.push({ id: f.friend_id, type: 'friend', position: loc, title: f.friend_name, address: loc.address || 'Nearby', avatar_url: f.friend_avatar_url, last_seen: f.last_seen });
        });
      }

      setMarkers(found);
      setNearbyEvents(found.filter(m => m.type === 'event').length);
      setNearbyBiz(found.filter(m => m.type === 'business').length);
      setNearbyFriends(found.filter(m => m.type === 'friend').length);
      setLoading(false);
    };
    load();
  }, [user?.id, profile?.location?.state]);

  const filtered = markers.filter(m => {
    const matchTab = activeTab === 'all' || m.type === activeTab.replace('businesses', 'business').replace('friends', 'friend').replace('events', 'event');
    const matchSearch = !search || m.title.toLowerCase().includes(search.toLowerCase()) || m.address.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  });

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'events', label: 'Events' }, { key: 'businesses', label: 'Businesses' }, { key: 'friends', label: 'Friends' },
  ];

  const pinColor = (t: MarkerData['type']) => t === 'business' ? '#006ec9' : t === 'event' ? '#93000a' : '#4da24e';

  return (
    <div className={`relative w-full overflow-hidden ${className ?? ''}`} style={{ height: '100dvh', background: 'var(--c-bg)' }}>

      {/* ── MAP ── */}
      <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!} libraries={['places']}>
        <Map
          defaultCenter={userCoords ?? NIGERIA_CENTER}
          defaultZoom={userCoords ? 14 : 6}
          gestureHandling="greedy"
          disableDefaultUI
          mapId="7bdaf6c131a6958be5380043f"
          className="w-full h-full"
          /* @ts-ignore */
          styles={DARK_MAP_STYLES}
        >
          {filtered.map(m => (
            <AdvancedMarker key={m.id} position={m.position} onClick={() => setSelected(m)}>
              <div className="flex flex-col items-center cursor-pointer">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg border-2"
                  style={{ background: pinColor(m.type), borderColor: 'var(--c-bg)' }}
                >
                  {m.type === 'event'    && <Calendar className="w-5 h-5 text-foreground" />}
                  {m.type === 'business' && <Briefcase className="w-5 h-5 text-foreground" />}
                  {m.type === 'friend'   && (
                    m.avatar_url
                      ? <div className="relative w-full h-full rounded-full overflow-hidden"><Image src={m.avatar_url} alt="" fill className="object-cover" sizes="40px" /></div>
                      : <Users className="w-5 h-5 text-foreground" />
                  )}
                </div>
                <div className="mt-1 px-2 py-0.5 rounded-full text-[0.5625rem] font-bold text-foreground" style={{ background: 'rgba(21,24,29,0.85)' }}>
                  {m.title.length > 14 ? m.title.slice(0, 12) + '…' : m.title}
                </div>
              </div>
            </AdvancedMarker>
          ))}

          {selected && (
            <InfoWindow position={selected.position} onCloseClick={() => setSelected(null)}>
              <div className="rounded-[11px] p-3 max-w-[220px]" style={{ background: 'var(--c-card)', border: '0.5px solid rgba(56,142,60,0.3)' }}>
                <span className="text-[0.5625rem] font-bold uppercase tracking-widest" style={{ color: selected.type === 'event' ? '#ffb4ab' : selected.type === 'business' ? '#a5c8ff' : '#82db7e' }}>
                  {selected.type === 'event' ? 'Live Event' : selected.type === 'business' ? 'Business' : 'Friend'}
                </span>
                <p className="text-sm font-bold mt-1 text-foreground" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>{selected.title}</p>
                <p className="text-[0.6875rem] mt-1" style={{ color: 'var(--c-text-muted)' }}>{selected.address}</p>
                {selected.attendees !== undefined && selected.type === 'event' && (
                  <p className="text-[0.6875rem]" style={{ color: 'var(--c-text-muted)' }}>{selected.attendees} attending</p>
                )}
                {selected.last_seen && (
                  <p className="text-[0.6875rem]" style={{ color: 'var(--c-text-muted)' }}>Last seen: {new Date(selected.last_seen).toLocaleTimeString()}</p>
                )}
                <button
                  onClick={() => { setSelected(null); selected.type === 'event' ? router.push(`/posts/${selected.id}`) : selected.type === 'business' ? router.push(`/businesses/${selected.id}`) : router.push(`/profile/${selected.id}`); }}
                  className="mt-3 w-full h-8 rounded-full text-xs font-bold text-foreground flex items-center justify-center gap-1"
                  style={{ background: '#388E3C' }}
                >
                  <Navigation className="w-3 h-3" /> View Details
                </button>
              </div>
            </InfoWindow>
          )}
        </Map>
      </APIProvider>

      {/* ── Header blur bar ── */}
      <header
        className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center px-6 py-4"
        style={{ background: 'rgba(16,20,24,0.8)', backdropFilter: 'blur(20px)' }}
      >
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#82DB7E"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          <span style={{ fontFamily: 'Jersey 25, sans-serif', fontSize: 22, color: '#259907' }}>Yrdly</span>
        </div>
        <button className="p-2 rounded-full transition-colors hover:bg-accent" style={{ color: 'var(--c-text-muted)' }}>
          <Search className="w-5 h-5" />
        </button>
      </header>

      {/* ── Search + filter overlay ── */}
      <div className="absolute top-20 left-4 right-4 z-10 space-y-3">
        <div
          className="flex items-center gap-3 rounded-full px-5 py-3 shadow-xl"
          style={{ background: 'var(--c-card2)', backdropFilter: 'blur(12px)', border: '0.5px solid #388E3C' }}
        >
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: '#82DB7E' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Explore your yard..."
            className="flex-1 bg-transparent border-none outline-none text-sm"
            style={{ color: 'var(--c-text)', fontFamily: 'Inter, sans-serif' }}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex-shrink-0 rounded-full px-5 py-2 text-xs font-bold shadow-md transition-all"
              style={
                activeTab === t.key
                  ? { background: '#82DB7E', color: '#00390a' }
                  : { background: 'var(--c-card2)', backdropFilter: 'blur(8px)', color: 'var(--c-text)', border: '0.5px solid rgba(64,73,61,0.6)' }
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Loading overlay ── */}
      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center" style={{ background: 'rgba(16,20,24,0.85)' }}>
          <div className="text-center space-y-3">
            <div className="w-10 h-10 rounded-full border-4 animate-spin mx-auto" style={{ borderColor: '#388E3C', borderTopColor: 'transparent' }} />
            <p className="text-sm" style={{ color: '#82db7e', fontFamily: 'Inter, sans-serif' }}>Loading map...</p>
          </div>
        </div>
      )}

      {/* ── Recenter FAB ── */}
      <RecenterButton coords={userCoords} />

      {/* ── Bottom panel ── */}
      <div className="absolute bottom-[88px] left-0 right-0 z-20 px-4">
        <div
          className="rounded-t-[28px] p-5"
          style={{ background: 'var(--c-card)', boxShadow: '0 -20px 40px rgba(0,0,0,0.6)', backdropFilter: 'blur(16px)' }}
        >
          {/* Drag handle */}
          <div className="w-12 h-1 rounded-full mx-auto mb-5" style={{ background: 'var(--c-card2)' }} />

          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-foreground" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Near You</h2>
              <p className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{nearbyEvents} active events and {nearbyFriends} friends nearby</p>
            </div>
            <button className="p-2 rounded-full" style={{ background: 'var(--c-card2)', color: '#82DB7E' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="12" y1="18" x2="12" y2="18"/></svg>
            </button>
          </div>

          {/* Horizontal scrolable mini cards */}
          <div className="flex gap-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {filtered.slice(0, 6).map(m => (
              <button
                key={m.id}
                onClick={() => setSelected(m)}
                className="min-w-[220px] rounded-xl p-3 flex gap-3 text-left transition-colors hover:bg-accent flex-shrink-0"
                style={{ background: 'var(--c-card)', border: '0.5px solid rgba(64,73,61,0.6)' }}
              >
                <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'var(--c-card2)' }}>
                  {m.image
                    ? <Image src={m.image} alt="" fill className="object-cover" sizes="64px" />
                    : (
                      <div className="w-full h-full flex items-center justify-center" style={{ background: pinColor(m.type) + '22' }}>
                        {m.type === 'event'    && <Calendar className="w-6 h-6" style={{ color: '#ffb4ab' }} />}
                        {m.type === 'business' && <Briefcase className="w-6 h-6" style={{ color: '#a5c8ff' }} />}
                        {m.type === 'friend'   && <Users className="w-6 h-6" style={{ color: '#82DB7E' }} />}
                      </div>
                    )
                  }
                </div>
                <div className="flex flex-col justify-center min-w-0">
                  <p className="text-[0.625rem] font-bold uppercase tracking-wider" style={{ color: m.type === 'business' ? '#a5c8ff' : m.type === 'event' ? '#6edf51' : '#82DB7E' }}>
                    {m.type}
                  </p>
                  <p className="text-sm font-bold text-foreground truncate">{m.title}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--c-text-muted)' }}>{m.distance || m.address}</p>
                </div>
              </button>
            ))}

            {filtered.length === 0 && !loading && (
              <p className="text-sm py-4 px-2" style={{ color: 'var(--c-text-muted)', fontFamily: 'Inter, sans-serif' }}>No places found nearby</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}