"use client";

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { Search, Navigation, Calendar, Briefcase, Users } from 'lucide-react';
import { Map, AdvancedMarker, InfoWindow, useMap } from '@vis.gl/react-google-maps';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-supabase-auth';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Supercluster from 'supercluster';

type FilterTab = 'all' | 'events' | 'businesses' | 'marketplace' | 'friends';

type MarkerData = {
  id: string;
  type: 'event' | 'business' | 'friend' | 'marketplace';
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
  price?: number;
};

// Helper for privacy jitter
const applyJitter = (lat: number, lng: number, offset = 0.002) => {
  const jitterLat = lat + (Math.random() - 0.5) * offset;
  const jitterLng = lng + (Math.random() - 0.5) * offset;
  return { lat: jitterLat, lng: jitterLng };
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
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [search, setSearch]             = useState('');
  const [activeTab, setActiveTab]       = useState<FilterTab>('all');
  const [nearbyEvents, setNearbyEvents] = useState(0);
  const [nearbyBiz, setNearbyBiz]       = useState(0);
  const [nearbyFriends, setNearbyFriends] = useState(0);
  const [nearbyMarket, setNearbyMarket]   = useState(0);
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

      // 1. Fetch Events
      let evtsQuery = supabase.from('events').select('*').not('location', 'is', null);
      // Assuming events table doesn't have 'state' or we filter by proximity later. For now fetch all.
      const { data: evts } = await evtsQuery;
      (evts || []).forEach(e => {
        const loc = extract(e.location);
        if (loc) found.push({ id: e.id, type: 'event', position: loc, title: e.title, address: loc.address || 'Location TBD', description: e.description, date: e.start_time, attendees: e.attendee_count || 0, image: e.image_url });
      });

      // 2. Fetch Businesses
      let bizsQuery = supabase.from('businesses').select('*').not('location', 'is', null);
      if (userState) bizsQuery = bizsQuery.eq('state', userState);
      const { data: bizs } = await bizsQuery;
      (bizs || []).forEach(b => {
        const loc = extract(b.location);
        if (loc) found.push({ id: b.id, type: 'business', position: loc, title: b.name, address: loc.address || 'Lagos, Nigeria', description: b.description, category: b.category, image: b.image_urls?.[0] });
      });

      // 3. Fetch Friends
      if (user?.id) {
        const { data: frds } = await supabase.rpc('get_friends_locations', { user_id: user.id });
        (frds || []).forEach((f: any) => {
          const loc = extract(f.location);
          if (loc) found.push({ id: f.friend_id, type: 'friend', position: applyJitter(loc.lat, loc.lng), title: f.friend_name, address: loc.address || 'Nearby', avatar_url: f.friend_avatar_url, last_seen: f.last_seen });
        });
      }

      // 4. Fetch Marketplace Items
      let postsQuery = supabase.from('posts').select('*').in('category', ['For Sale', 'General']).eq('is_sold', false).not('event_location', 'is', null);
      if (userState) postsQuery = postsQuery.eq('state', userState);
      const { data: items } = await postsQuery;
      (items || []).forEach(p => {
        const loc = extract(typeof p.event_location === 'string' ? null : p.event_location);
        if (loc) found.push({ id: p.id, type: 'marketplace', position: applyJitter(loc.lat, loc.lng), title: p.title || p.text, address: loc.address || 'Nearby', description: p.text, price: p.price, image: p.image_urls?.[0] });
      });

      setMarkers(found);
      setNearbyEvents(found.filter(m => m.type === 'event').length);
      setNearbyBiz(found.filter(m => m.type === 'business').length);
      setNearbyFriends(found.filter(m => m.type === 'friend').length);
      setNearbyMarket(found.filter(m => m.type === 'marketplace').length);
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
    { key: 'all', label: 'All' }, { key: 'events', label: 'Events' }, { key: 'businesses', label: 'Businesses' }, { key: 'marketplace', label: 'Market' }, { key: 'friends', label: 'Friends' },
  ];

  const pinColor = (t: MarkerData['type']) => t === 'business' ? '#006ec9' : t === 'event' ? '#93000a' : t === 'marketplace' ? '#E6A100' : '#4da24e';

  return (
    <div className={`relative w-full overflow-hidden ${className ?? ''}`} style={{ height: '100dvh', background: 'var(--c-bg)' }}>

      {/* ── MAP ── */}
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
          <AdvancedMarker key={m.id} position={m.position} onClick={() => { setSelected(m); setDrawerOpen(true); }}>
            <div className="flex flex-col items-center cursor-pointer">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg border-2"
                style={{ background: pinColor(m.type), borderColor: 'var(--c-bg)' }}
              >
                {m.type === 'event'    && <Calendar className="w-5 h-5 text-foreground" />}
                {m.type === 'business' && <Briefcase className="w-5 h-5 text-foreground" />}
                {m.type === 'marketplace' && (
                  <span className="text-foreground font-bold text-[0.6rem] px-1">
                    {m.price === 0 ? 'Free' : `₦${(m.price || 0) / 1000}k`}
                  </span>
                )}
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
      </Map>

      {/* ── Rich Map Pin Drawer ── */}
      <Drawer open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) setTimeout(() => setSelected(null), 300); }}>
        <DrawerContent>
          <div className="px-6 py-4 pb-8 space-y-4">
            {selected && (
              <>
                <div className="flex items-start gap-4">
                  {selected.image ? (
                    <div className="w-20 h-20 rounded-[11px] overflow-hidden flex-shrink-0 relative">
                      <Image src={selected.image} alt="" fill className="object-cover" />
                    </div>
                  ) : selected.avatar_url ? (
                    <div className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0 relative border-2 border-primary">
                      <Image src={selected.avatar_url} alt="" fill className="object-cover" />
                    </div>
                  ) : null}
                  
                  <div className="flex-1">
                    <span className="text-[0.625rem] font-bold uppercase tracking-widest" style={{ color: selected.type === 'event' ? '#ffb4ab' : selected.type === 'business' ? '#a5c8ff' : selected.type === 'marketplace' ? '#E6A100' : '#82db7e' }}>
                      {selected.type === 'event' ? 'Live Event' : selected.type === 'business' ? 'Local Business' : selected.type === 'marketplace' ? 'Marketplace' : 'Friend'}
                    </span>
                    <DrawerTitle className="text-xl font-bold mt-1 text-foreground" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                      {selected.title}
                    </DrawerTitle>
                    <DrawerDescription className="mt-1 flex items-center gap-1.5 text-sm">
                      {selected.address}
                    </DrawerDescription>
                  </div>
                </div>

                <div className="space-y-2">
                  {selected.price !== undefined && (
                    <p className="text-xl font-bold text-[#82db7e]">
                      {selected.price === 0 ? 'Free' : `₦${(selected.price / 1000).toLocaleString()}k`}
                    </p>
                  )}
                  {selected.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {selected.description}
                    </p>
                  )}
                  {selected.attendees !== undefined && selected.type === 'event' && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Users className="w-4 h-4" /> {selected.attendees} attending
                    </div>
                  )}
                  {selected.date && (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" /> {new Date(selected.date).toLocaleDateString()}
                    </div>
                  )}
                </div>

                <Button 
                  className="w-full h-12 rounded-full font-bold text-base mt-2" 
                  style={{ background: '#388E3C', color: 'white' }}
                  onClick={() => { 
                    setDrawerOpen(false); 
                    selected.type === 'event' ? router.push(`/events/${selected.id}`) : 
                    selected.type === 'business' ? router.push(`/businesses/${selected.id}`) : 
                    selected.type === 'marketplace' ? router.push(`/marketplace/${selected.id}`) : 
                    router.push(`/profile/${selected.id}`); 
                  }}
                >
                  View Details
                </Button>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

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