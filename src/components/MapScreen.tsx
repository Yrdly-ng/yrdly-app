"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { Search, Navigation, Calendar, Briefcase, Users, MapPin } from 'lucide-react';
import { Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-supabase-auth';

import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Drawer as VaulDrawer } from 'vaul';
import { Button } from '@/components/ui/button';
import Supercluster from 'supercluster';
import { cn } from '@/lib/utils';

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

const NIGERIA_CENTER = { lat: 9.082, lng: 8.6753 };

function MapLogicOverlay({ setBounds, setZoom }: { setBounds: (b: [number,number,number,number]|null) => void, setZoom: (z: number) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const update = () => {
      const b = map.getBounds();
      if (b) {
        setBounds([
          b.getSouthWest().lng(),
          b.getSouthWest().lat(),
          b.getNorthEast().lng(),
          b.getNorthEast().lat()
        ]);
      }
      setZoom(map.getZoom() || 14);
    };
    update();
    const l1 = map.addListener('idle', update);
    return () => { (window as any).google.maps.event.removeListener(l1); };
  }, [map, setBounds, setZoom]);
  return null;
}

function RecenterButton({ coords }: { coords: { lat: number; lng: number } | null }) {
  const map = useMap();
  const recenter = useCallback(() => {
    if (!map) return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { map.panTo({ lat: pos.coords.latitude, lng: pos.coords.longitude }); map.setZoom(15); },
        () => { if (coords) { map.panTo(coords); map.setZoom(14); } }
      );
    } else if (coords) {
      map.panTo(coords); map.setZoom(14);
    }
  }, [map, coords]);

  return (
    <button
      onClick={recenter}
      className="absolute right-4 z-20 w-12 h-12 rounded-full shadow-[0_8px_30px_rgb(0,0,0,0.3)] flex items-center justify-center text-primary-foreground transition-transform active:scale-90"
      style={{ top: 180, background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.2)' }}
    >
      <Navigation className="w-5 h-5 fill-white" />
    </button>
  );
}

interface MapScreenProps { className?: string }

export function MapScreen({ className }: MapScreenProps) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const map = useMap();
  
  const [markers, setMarkers]           = useState<MarkerData[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState<MarkerData | null>(null);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [search, setSearch]             = useState('');
  const [activeTab, setActiveTab]       = useState<FilterTab>('all');
  const [userCoords, setUserCoords]     = useState<{ lat: number; lng: number } | null>(null);
  
  // Viewport tracking
  const [bounds, setBounds] = useState<[number,number,number,number]|null>(null);
  const [zoom, setZoom] = useState(14);

  // Initialize Supercluster
  const supercluster = useMemo(() => new Supercluster({ radius: 60, maxZoom: 16 }), []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {} 
      );
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const found: MarkerData[] = [];
      const extract = (loc: any): { lat: number; lng: number; address: string } | null => {
        if (!loc) return null;
        if (loc.geopoint) return { lat: loc.geopoint.latitude, lng: loc.geopoint.longitude, address: loc.address || '' };
        if (loc.latitude && loc.longitude) return { lat: loc.latitude, lng: loc.longitude, address: loc.address || '' };
        if (loc.lat && loc.lng) return { lat: loc.lat, lng: loc.lng, address: loc.address || '' };
        return null;
      };

      const userState = profile?.location?.state;

      // Fetch Events
      const { data: evts } = await supabase.from('events')
        .select('*')
        .eq('status', 'PUBLISHED')
        .or(`end_time.gte.${new Date().toISOString()},start_time.gte.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`)
        .not('lat', 'is', null)
        .not('lng', 'is', null);
      (evts || []).forEach(e => {
        if (e.lat && e.lng) {
          found.push({ id: e.id, type: 'event', position: { lat: Number(e.lat), lng: Number(e.lng) }, title: e.title, address: e.location_address || 'Location TBD', description: e.description, date: e.start_time, attendees: e.attendee_count || 0, image: e.cover_image_url });
        }
      });

      // Fetch Businesses
      let bizsQuery = supabase.from('businesses').select('*').not('location', 'is', null);
      if (userState) bizsQuery = bizsQuery.eq('state', userState);
      const { data: bizs } = await bizsQuery;
      (bizs || []).forEach(b => {
        const loc = extract(b.location);
        if (loc) found.push({ id: b.id, type: 'business', position: loc, title: b.name, address: loc.address || 'Local Business', description: b.description, category: b.category, image: b.image_urls?.[0] });
      });

      // Fetch Friends
      if (user?.id) {
        const { data: frds } = await supabase.rpc('get_friends_locations', { user_id: user.id });
        (frds || []).forEach((f: any) => {
          const loc = extract(f.location);
          if (loc) found.push({ id: f.friend_id, type: 'friend', position: applyJitter(loc.lat, loc.lng), title: f.friend_name, address: loc.address || 'Nearby', avatar_url: f.friend_avatar_url, last_seen: f.last_seen });
        });
      }

      // Fetch Marketplace
      let postsQuery = supabase.from('posts').select('*').in('category', ['For Sale', 'General']).eq('is_sold', false).not('event_location', 'is', null);
      if (userState) postsQuery = postsQuery.eq('state', userState);
      const { data: items } = await postsQuery;
      (items || []).forEach(p => {
        const loc = extract(typeof p.event_location === 'string' ? null : p.event_location);
        if (loc) found.push({ id: p.id, type: 'marketplace', position: applyJitter(loc.lat, loc.lng), title: p.title || p.text, address: loc.address || 'Nearby', description: p.text, price: p.price, image: p.image_urls?.[0] });
      });

      setMarkers(found);
      setLoading(false);
    };
    load();
  }, [user?.id, profile?.location?.state]);

  const filtered = useMemo(() => markers.filter(m => {
    const matchTab = activeTab === 'all' || m.type === activeTab.replace('businesses', 'business').replace('friends', 'friend').replace('events', 'event');
    const matchSearch = !search || m.title.toLowerCase().includes(search.toLowerCase()) || m.address.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  }), [markers, activeTab, search]);

  // Load supercluster
  useEffect(() => {
    const points = filtered.map(m => ({
      type: 'Feature' as const,
      properties: { cluster: false, ...m },
      geometry: { type: 'Point' as const, coordinates: [m.position.lng, m.position.lat] }
    }));
    supercluster.load(points);
  }, [filtered, supercluster]);

  const clusters = bounds ? supercluster.getClusters(bounds, zoom) : [];

  // Filter for dynamic bottom list
  const visibleMarkers = useMemo(() => {
    if (!bounds) return filtered;
    const [w, s, e, n] = bounds;
    return filtered.filter(m => m.position.lng >= w && m.position.lng <= e && m.position.lat >= s && m.position.lat <= n);
  }, [bounds, filtered]);

  const TABS: { key: FilterTab; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'events', label: 'Events' }, { key: 'businesses', label: 'Businesses' }, { key: 'marketplace', label: 'Market' }, { key: 'friends', label: 'Friends' },
  ];

  const getPinColor = (t: string) => t === 'business' ? '#a5c8ff' : t === 'event' ? '#ffb4ab' : t === 'marketplace' ? '#E6A100' : '#82db7e';
  const getGradient = (t: string) => t === 'event' ? 'linear-gradient(135deg, #ff4b4b, #b30000)' : t === 'business' ? 'linear-gradient(135deg, #4b9fff, #0044b3)' : t === 'marketplace' ? 'linear-gradient(135deg, #ffc107, #e65100)' : 'linear-gradient(135deg, #4caf50, #1b5e20)';

  return (
    <div className={cn("relative w-full overflow-hidden", className)} style={{ height: '100dvh', background: 'var(--c-bg)' }}>
      
      {/* ── MAP ── */}
      <Map
        defaultCenter={userCoords ?? NIGERIA_CENTER}
        defaultZoom={userCoords ? 14 : 6}
        gestureHandling="greedy"
        disableDefaultUI
        mapId="7bdaf6c131a6958be5380043f"
        className="w-full h-full absolute inset-0"
      >
        <MapLogicOverlay setBounds={setBounds} setZoom={setZoom} />
        
        {/* User Location Pulsing Dot */}
        {userCoords && (
          <AdvancedMarker position={userCoords} zIndex={100}>
            <div className="relative flex items-center justify-center">
              <div className="absolute w-14 h-14 bg-blue-500/20 rounded-full animate-ping" />
              <div className="absolute w-8 h-8 bg-blue-500/40 rounded-full animate-pulse" />
              <div className="relative w-4 h-4 bg-blue-500 rounded-full border-[3px] border-border shadow-lg" />
            </div>
          </AdvancedMarker>
        )}

        {/* Clusters & Markers */}
        {clusters.map(cluster => {
          const [lng, lat] = cluster.geometry.coordinates;
          const { cluster: isCluster, point_count } = cluster.properties;
          
          if (isCluster) {
            return (
              <AdvancedMarker 
                key={`cluster-${cluster.id}`} 
                position={{ lat, lng }} 
                onClick={() => {
                  if (!map) return;
                  const expansionZoom = supercluster.getClusterExpansionZoom(cluster.id as number);
                  map.setZoom(expansionZoom);
                  map.panTo({ lat, lng });
                }}
              >
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-primary-foreground font-black text-lg border-4 border-[var(--c-card)] shadow-2xl transition-transform hover:scale-110" style={{ background: 'hsl(var(--primary))' }}>
                  {point_count}
                </div>
              </AdvancedMarker>
            );
          }
          
          const m = cluster.properties as unknown as MarkerData;
          const isToday = m.type === 'event' && m.date && new Date(m.date).toDateString() === new Date().toDateString();

          return (
            <AdvancedMarker key={m.id} position={m.position} onClick={() => { setSelected(m); setDrawerOpen(true); }}>
              <div className="flex flex-col items-center cursor-pointer group">
                <div className="relative">
                  {isToday && (
                    <div className="absolute -inset-2 bg-red-500/30 rounded-full animate-ping" />
                  )}
                  <div
                    className={cn(
                      "w-11 h-11 rounded-full flex items-center justify-center shadow-xl border-2 transition-transform duration-300 group-hover:scale-110",
                      m.type === 'friend' && m.avatar_url ? 'p-0 border-primary' : 'border-background'
                    )}
                    style={{ background: getGradient(m.type) }}
                  >
                    {m.type === 'event'    && <Calendar className="w-5 h-5 text-primary-foreground" />}
                    {m.type === 'business' && <Briefcase className="w-5 h-5 text-primary-foreground" />}
                    {m.type === 'marketplace' && (
                      <span className="text-primary-foreground font-black text-[0.65rem] px-1 tracking-tighter">
                        {m.price === 0 ? 'Free' : `₦${(m.price || 0) / 1000}k`}
                      </span>
                    )}
                    {m.type === 'friend'   && (
                      m.avatar_url
                        ? <div className="relative w-full h-full rounded-full overflow-hidden"><Image src={m.avatar_url} alt="" fill className="object-cover" sizes="44px" /></div>
                        : <Users className="w-5 h-5 text-primary-foreground" />
                    )}
                  </div>
                </div>
                
                <div className="mt-1.5 px-2.5 py-1 rounded-full text-[0.65rem] font-bold text-primary-foreground shadow-md opacity-90 group-hover:opacity-100 transition-opacity backdrop-blur-md" style={{ background: 'rgba(21,24,29,0.85)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {m.title.length > 16 ? m.title.slice(0, 14) + '…' : m.title}
                </div>
              </div>
            </AdvancedMarker>
          );
        })}
      </Map>

      {/* ── Detail Modal Drawer ── */}
      <Drawer open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) setTimeout(() => setSelected(null), 300); }}>
        <DrawerContent>
          <div className="px-6 py-4 pb-8 space-y-5">
            {selected && (
              <>
                <div className="flex items-start gap-4">
                  {selected.image ? (
                    <div className="w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 relative shadow-md">
                      <Image src={selected.image} alt="" fill className="object-cover" />
                    </div>
                  ) : selected.avatar_url ? (
                    <div className="w-24 h-24 rounded-full overflow-hidden flex-shrink-0 relative border-4 border-background shadow-md">
                      <Image src={selected.avatar_url} alt="" fill className="object-cover" />
                    </div>
                  ) : null}
                  
                  <div className="flex-1 pt-1">
                    <span className="text-[0.65rem] font-black uppercase tracking-widest px-2 py-0.5 rounded-sm" style={{ background: `${getPinColor(selected.type)}22`, color: getPinColor(selected.type) }}>
                      {selected.type === 'event' ? 'Live Event' : selected.type === 'business' ? 'Local Business' : selected.type === 'marketplace' ? 'Marketplace' : 'Friend'}
                    </span>
                    <DrawerTitle className="text-2xl font-bold mt-2 text-foreground leading-tight" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>
                      {selected.title}
                    </DrawerTitle>
                    <DrawerDescription className="mt-1.5 flex items-start gap-1.5 text-sm">
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-70" />
                      <span className="line-clamp-2">{selected.address}</span>
                    </DrawerDescription>
                  </div>
                </div>

                <div className="space-y-2.5 bg-muted/30 p-4 rounded-2xl border border-border/50">
                  {selected.price !== undefined && (
                    <p className="text-2xl font-black" style={{ color: getPinColor('marketplace') }}>
                      {selected.price === 0 ? 'Free' : `₦${(selected.price).toLocaleString()}`}
                    </p>
                  )}
                  {selected.description && (
                    <p className="text-sm text-foreground/80 leading-relaxed">
                      {selected.description}
                    </p>
                  )}
                  {selected.attendees !== undefined && selected.type === 'event' && (
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground/70">
                      <Users className="w-4 h-4" /> {selected.attendees} attending
                    </div>
                  )}
                  {selected.date && (
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground/70">
                      <Calendar className="w-4 h-4" /> {new Date(selected.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-4">
                  <a 
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selected.position.lat},${selected.position.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex h-12 rounded-full font-bold text-sm bg-accent text-accent-foreground hover:bg-accent/80 items-center justify-center gap-2 transition-colors"
                  >
                    <Navigation className="w-4 h-4" /> Get Directions
                  </a>
                  <Button 
                    className="flex-1 h-12 rounded-full font-bold text-sm" 
                    style={{ background: getGradient(selected.type), color: 'white' }}
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
                </div>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* ── Header overlay ── */}
      <header
        className="absolute top-0 left-0 right-0 z-20 flex justify-between items-center px-6 py-4 pb-6"
        style={{ background: 'linear-gradient(to bottom, rgba(16,20,24,0.95) 0%, rgba(16,20,24,0) 100%)' }}
      >
        <div className="flex items-center gap-2 drop-shadow-md">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#82DB7E"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
          <span style={{ fontFamily: 'Jersey 25, sans-serif', fontSize: 26, color: '#259907' }}>Yrdly</span>
        </div>
      </header>

      {/* ── Search + filter overlay ── */}
      <div className="absolute top-16 left-4 right-4 z-10 space-y-3">
        <div
          className="flex items-center gap-3 rounded-2xl px-5 py-3.5 shadow-2xl transition-all hover:bg-card focus-within:bg-card focus-within:ring-2 focus-within:ring-primary/50"
          style={{ background: 'rgba(21,24,29,0.75)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <Search className="w-5 h-5 flex-shrink-0 opacity-70" style={{ color: '#82DB7E' }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search this area..."
            className="flex-1 bg-transparent border-none outline-none text-sm font-medium placeholder:text-muted-foreground/70"
            style={{ color: 'var(--c-text)', fontFamily: 'Inter, sans-serif' }}
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 px-1" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex-shrink-0 rounded-full px-5 py-2.5 text-xs font-bold shadow-lg transition-all"
              style={
                activeTab === t.key
                  ? { background: '#82DB7E', color: '#00390a' }
                  : { background: 'rgba(21,24,29,0.75)', backdropFilter: 'blur(16px)', color: 'var(--c-text)', border: '1px solid rgba(255,255,255,0.1)' }
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-16 h-16 bg-muted/20 animate-pulse rounded-full border-4 border-primary/20 mb-4" />
          <div className="w-32 h-4 bg-muted/20 animate-pulse rounded-full" />
        </div>
      )}

      <RecenterButton coords={userCoords} />

      {/* ── Fluid Bottom Sheet (Vaul) ── */}
      <VaulDrawer.Root 
        snapPoints={[150, 400, '0.9']} 
        activeSnapPoint={150} 
        setActiveSnapPoint={() => {}} 
        modal={false} 
        open={true} 
        dismissible={false}
      >
        <VaulDrawer.Portal>
          <VaulDrawer.Content 
            className="fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[24px] border-t border-border/40 shadow-[0_-20px_40px_rgba(0,0,0,0.5)] transition-all"
            style={{ background: 'rgba(16,20,24,0.85)', backdropFilter: 'blur(20px)' }}
          >
            <div className="w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
              <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
            </div>
            
            <div className="px-5 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Visible Near You</h2>
                  <p className="text-xs font-medium text-muted-foreground/80 mt-0.5">
                    {visibleMarkers.length} places in this area
                  </p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-3" style={{ scrollbarWidth: 'none' }}>
              {visibleMarkers.slice(0, 20).map(m => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelected(m); 
                    setDrawerOpen(true);
                    if (map) { map.panTo(m.position); map.setZoom(16); }
                  }}
                  className="w-full rounded-2xl p-3.5 flex items-center gap-4 text-left transition-colors hover:bg-accent/50 border border-border/30 bg-card/40 backdrop-blur-md"
                >
                  <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 relative shadow-sm">
                    {m.image || m.avatar_url
                      ? <Image src={(m.image || m.avatar_url)!} alt="" fill className="object-cover" sizes="56px" />
                      : (
                        <div className="w-full h-full flex items-center justify-center" style={{ background: `${getPinColor(m.type)}22` }}>
                          {m.type === 'event'    && <Calendar className="w-5 h-5" style={{ color: getPinColor(m.type) }} />}
                          {m.type === 'business' && <Briefcase className="w-5 h-5" style={{ color: getPinColor(m.type) }} />}
                          {m.type === 'friend'   && <Users className="w-5 h-5" style={{ color: getPinColor(m.type) }} />}
                          {m.type === 'marketplace' && <MapPin className="w-5 h-5" style={{ color: getPinColor(m.type) }} />}
                        </div>
                      )
                    }
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <p className="text-[0.6rem] font-bold uppercase tracking-wider mb-0.5" style={{ color: getPinColor(m.type) }}>
                      {m.type}
                    </p>
                    <p className="text-sm font-bold text-foreground truncate">{m.title}</p>
                    <p className="text-xs truncate opacity-70 mt-0.5">{m.distance || m.address}</p>
                  </div>
                  {m.price !== undefined && (
                    <div className="font-black text-sm pl-2 flex-shrink-0" style={{ color: getPinColor('marketplace') }}>
                      {m.price === 0 ? 'Free' : `₦${(m.price/1000).toLocaleString()}k`}
                    </div>
                  )}
                </button>
              ))}

              {visibleMarkers.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-10 text-center opacity-70">
                  <Navigation className="w-8 h-8 mb-3 opacity-50" />
                  <p className="text-sm font-medium">No places found in this view.</p>
                  <p className="text-xs mt-1">Pan the map to explore more areas.</p>
                </div>
              )}
            </div>
          </VaulDrawer.Content>
        </VaulDrawer.Portal>
      </VaulDrawer.Root>
    </div>
  );
}