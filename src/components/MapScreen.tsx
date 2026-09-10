"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { Search, Navigation, Calendar, Briefcase, Users, MapPin, Plus, Locate, Layers, ArrowLeft } from 'lucide-react';
import { Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useLocation } from '@/contexts/LocationContext';

import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Drawer as VaulDrawer } from 'vaul';
import { Button } from '@/components/ui/button';
import Supercluster from 'supercluster';
import { cn } from '@/lib/utils';

type FilterTab = 'all' | 'marketplace' | 'friends' | 'events' | 'businesses' | 'posts';

type MarkerData = {
  id: string;
  type: 'event' | 'business' | 'friend' | 'marketplace' | 'post';
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
  { elementType: 'geometry', stylers: [{ color: '#0d1117' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a9bb0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0d1117' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a2332' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0d1117' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d2236' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#0d1a0f' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
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
      title="Locate Me"
      className="flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-bold shadow-2xl transition-all hover:scale-105 active:scale-95"
      style={{ background: 'rgba(16,20,24,0.92)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.12)', color: '#ccc', position: 'absolute', right: 16, top: 180, zIndex: 20 }}
    >
      <Locate className="w-4 h-4" style={{ color: '#82DB7E' }} />
      <span>Locate me</span>
    </button>
  );
}

interface MapScreenProps { className?: string }

export function MapScreen({ className }: MapScreenProps) {
  const { user, profile } = useAuth();
  const { activeFilter } = useLocation();
  const router = useRouter();
  const map = useMap();
  
  const [markers, setMarkers]           = useState<MarkerData[]>([]);
  const [loading, setLoading]           = useState(true);
  const [selected, setSelected]         = useState<MarkerData | null>(null);
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [search, setSearch]             = useState('');
  const [activeTab, setActiveTab]       = useState<FilterTab>('all');
  const [userCoords, setUserCoords]     = useState<{ lat: number; lng: number } | null>(null);
  const [eta, setEta]                   = useState<{ duration_seconds: number; duration_in_traffic_seconds: number; distance_meters: number } | null>(null);
  const [etaLoading, setEtaLoading]     = useState(false);
  
  // Viewport tracking
  const [bounds, setBounds] = useState<[number,number,number,number]|null>(null);
  const [zoom, setZoom] = useState(14);
  const [clusters, setClusters] = useState<ReturnType<typeof supercluster.getClusters>>([]);

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

  // Fetch ETA when selected pin or userCoords change
  useEffect(() => {
    if (!selected || !userCoords) {
      setEta(null);
      return;
    }
    let active = true;
    const fetchEta = async () => {
      setEtaLoading(true);
      setEta(null);
      try {
        const res = await fetch('/api/directions/eta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: { lat: userCoords.lat, lng: userCoords.lng },
            destination: { lat: selected.position.lat, lng: selected.position.lng },
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (active) setEta(data);
        }
      } catch (err) {
        console.warn('Failed to fetch ETA:', err);
      } finally {
        if (active) setEtaLoading(false);
      }
    };
    fetchEta();
    return () => { active = false; };
  }, [selected, userCoords]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const found: MarkerData[] = [];
      const extract = (loc: any): { lat: number; lng: number; address: string } | null => {
        if (!loc) return null;
        if (loc.lat && loc.lng) return { lat: loc.lat, lng: loc.lng, address: loc.address || '' };
        return null;
      };

      const filterState = activeFilter?.state || profile?.home_state;
      const filterLga   = activeFilter?.lga   || profile?.home_lga;

      // Fetch Events — filtered by activeFilter
      let evtQuery = supabase.from('events')
        .select('*')
        .eq('status', 'PUBLISHED')
        .or(`end_time.gte.${new Date().toISOString()},start_time.gte.${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`)
        .not('lat', 'is', null)
        .not('lng', 'is', null);
      if (filterState) evtQuery = evtQuery.eq('state', filterState);
      if (filterLga)   evtQuery = evtQuery.eq('lga', filterLga);
      const { data: evts } = await evtQuery;
      (evts || []).forEach(e => {
        if (e.lat && e.lng) {
          found.push({ id: e.id, type: 'event', position: { lat: Number(e.lat), lng: Number(e.lng) }, title: e.title, address: e.location_address || 'Location TBD', description: e.description, date: e.start_time, attendees: e.attendee_count || 0, image: e.cover_image_url });
        }
      });

      // Fetch Businesses — try lat/lng first, fall back to location JSON
      const { data: bizs } = await supabase.from('businesses').select('*').eq('is_active', true);
      (bizs || []).forEach(b => {
        const lat = b.lat ?? b.location?.lat ?? b.location?.latitude;
        const lng = b.lng ?? b.location?.lng ?? b.location?.longitude;
        if (lat && lng) {
          found.push({ id: b.id, type: 'business', position: { lat: Number(lat), lng: Number(lng) }, title: b.name, address: b.location?.address || 'Local Business', description: b.description, category: b.category, image: b.image_urls?.[0] });
        }
      });

      // Fetch Friends
      if (user?.id) {
        const { data: frds } = await supabase.rpc('get_friends_locations', { user_id: user.id });
        (frds || []).forEach((f: any) => {
          const lat = f.home_lat ?? f.location?.lat ?? f.location?.latitude;
          const lng = f.home_lng ?? f.location?.lng ?? f.location?.longitude;
          if (lat && lng) {
            found.push({
              id: f.friend_id,
              type: 'friend',
              position: applyJitter(Number(lat), Number(lng)),
              title: f.friend_name,
              address: f.home_address || f.location?.address || 'Nearby',
              avatar_url: f.friend_avatar_url,
              last_seen: f.last_seen
            });
          }
        });
      }

      // Fetch Marketplace — use canonical lat/lng columns
      let postsQuery = supabase.from('posts').select('*')
        .in('category', ['For Sale', 'General'])
        .eq('is_sold', false)
        .not('lat', 'is', null)
        .not('lng', 'is', null);
      if (filterState) postsQuery = postsQuery.eq('state', filterState);
      if (filterLga)   postsQuery = postsQuery.eq('lga', filterLga);
      const { data: items } = await postsQuery;
      (items || []).forEach(p => {
        if (p.lat && p.lng) {
          found.push({ id: p.id, type: 'marketplace', position: applyJitter(Number(p.lat), Number(p.lng)), title: p.title || p.text, address: p.location_address || 'Nearby', description: p.text, price: p.price, image: p.image_urls?.[0] });
        }
      });

      setMarkers(found);
      setLoading(false);
    };
    load();
  }, [user?.id, activeFilter?.state, activeFilter?.lga, profile?.home_state]);

  const filtered = useMemo(() => markers.filter(m => {
    const matchTab = activeTab === 'all' || m.type === activeTab.replace('businesses', 'business').replace('events', 'event');
    const matchSearch = !search || m.title.toLowerCase().includes(search.toLowerCase()) || m.address.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  }), [markers, activeTab, search]);

  // Load supercluster and update clusters state
  useEffect(() => {
    const points = filtered.map(m => ({
      type: 'Feature' as const,
      properties: { cluster: false, ...m },
      geometry: { type: 'Point' as const, coordinates: [m.position.lng, m.position.lat] }
    }));
    supercluster.load(points);
    if (bounds) {
      setClusters(supercluster.getClusters(bounds, zoom));
    }
  }, [filtered, supercluster, bounds, zoom]);

  // Filter for dynamic bottom list
  const visibleMarkers = useMemo(() => {
    if (!bounds) return filtered;
    const [w, s, e, n] = bounds;
    return filtered.filter(m => m.position.lng >= w && m.position.lng <= e && m.position.lat >= s && m.position.lat <= n);
  }, [bounds, filtered]);

  const TABS: { key: FilterTab; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'all',          label: 'All',         icon: <Layers className="w-3.5 h-3.5" />,     color: '#82DB7E' },
    { key: 'marketplace',  label: 'Marketplace', icon: <MapPin className="w-3.5 h-3.5" />,     color: '#82DB7E' },
    { key: 'friends',      label: 'Friends',     icon: <Users className="w-3.5 h-3.5" />,      color: '#8B5CF6' },
    { key: 'events',       label: 'Events',      icon: <Calendar className="w-3.5 h-3.5" />,   color: '#F59E0B' },
    { key: 'businesses',   label: 'Businesses',  icon: <Briefcase className="w-3.5 h-3.5" />,  color: '#3B82F6' },
    { key: 'posts',        label: 'Posts',       icon: <Layers className="w-3.5 h-3.5" />,     color: '#82DB7E' },
  ];

  const getPinColor = (t: string) => t === 'friend' ? '#8B5CF6' : t === 'business' ? '#3B82F6' : t === 'event' ? '#F59E0B' : '#82DB7E';
  const getGradient = (t: string) => t === 'friend' ? 'linear-gradient(135deg, #a855f7, #6b21a8)' : t === 'event' ? 'linear-gradient(135deg, #f59e0b, #b45309)' : t === 'business' ? 'linear-gradient(135deg, #3b82f6, #1e40af)' : 'linear-gradient(135deg, #82db7e, #15803d)';

  return (
    <div className={cn("relative w-full overflow-hidden bg-[var(--yrdly-dark)] text-foreground font-yrdly-body h-[100dvh]", className)}>
      
      {/* ── MAP ── */}
      <Map
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"}
        defaultCenter={userCoords ?? NIGERIA_CENTER}
        defaultZoom={userCoords ? 14 : 6}
        gestureHandling="greedy"
        disableDefaultUI
        styles={DARK_MAP_STYLES}
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
                <div className="w-12 h-12 rounded-full flex items-center justify-center text-primary-foreground font-yrdly-display font-black text-lg border-4 border-[var(--yrdly-glass-border)] shadow-2xl transition-transform hover:scale-110" style={{ background: 'hsl(var(--primary))' }}>
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
                    <div className="absolute -inset-2 bg-amber-500/30 rounded-full animate-ping" />
                  )}
                  {/* Circular marker with icon or avatar */}
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center shadow-xl border-[2.5px] transition-transform duration-200 group-hover:scale-110 overflow-hidden"
                    style={{
                      background: m.type === 'friend' ? 'rgba(139,92,246,0.15)' : m.type === 'event' ? 'rgba(245,158,11,0.15)' : m.type === 'business' ? 'rgba(34,197,94,0.15)' : 'rgba(230,161,0,0.15)',
                      borderColor: m.type === 'friend' ? '#8B5CF6' : m.type === 'event' ? '#F59E0B' : m.type === 'business' ? '#22c55e' : '#E6A100',
                    }}
                  >
                    {m.type === 'friend' && m.avatar_url
                      ? <div className="relative w-full h-full"><Image src={m.avatar_url} alt="" fill className="object-cover" sizes="44px" /></div>
                      : m.type === 'friend' ? <Users className="w-5 h-5" style={{ color: '#8B5CF6' }} />
                      : m.type === 'event' ? <Calendar className="w-5 h-5" style={{ color: '#F59E0B' }} />
                      : m.type === 'business' ? <Briefcase className="w-5 h-5" style={{ color: '#22c55e' }} />
                      : <MapPin className="w-5 h-5" style={{ color: '#E6A100' }} />}
                  </div>
                  {/* Dot below */}
                  <div className="w-2 h-2 rounded-full mx-auto mt-1 shadow-md" style={{ backgroundColor: m.type === 'friend' ? '#8B5CF6' : m.type === 'event' ? '#F59E0B' : m.type === 'business' ? '#22c55e' : '#E6A100' }} />
                </div>
              </div>
            </AdvancedMarker>
          );
        })}
      </Map>

      {/* ── Detail Modal Drawer ── */}
      <Drawer open={drawerOpen} onOpenChange={(open) => { setDrawerOpen(open); if (!open) setTimeout(() => setSelected(null), 300); }}>
        <DrawerContent className="bg-[var(--yrdly-dark)] border-t border-[var(--yrdly-glass-border)] text-foreground font-yrdly-body">
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
                    <span className="text-[0.65rem] font-yrdly-display font-black uppercase tracking-widest px-2 py-0.5 rounded-sm" style={{ background: `${getPinColor(selected.type)}22`, color: getPinColor(selected.type) }}>
                      {selected.type === 'event' ? 'Live Event' : selected.type === 'business' ? 'Local Business' : selected.type === 'marketplace' ? 'Marketplace' : 'Friend'}
                    </span>
                    <DrawerTitle className="text-2xl font-yrdly-display font-bold mt-2 text-foreground leading-tight">
                      {selected.title}
                    </DrawerTitle>
                    <DrawerDescription className="mt-1.5 flex items-start gap-1.5 text-sm font-yrdly-body text-[var(--yrdly-label)]">
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-70" />
                      <span className="line-clamp-2">{selected.address}</span>
                    </DrawerDescription>
                  </div>
                </div>

                <div className="space-y-2.5 bg-[var(--yrdly-glass-bg)] p-4 rounded-2xl border border-[var(--yrdly-glass-border)]">
                  {selected.price !== undefined && (
                    <p className="text-2xl font-yrdly-display font-black" style={{ color: getPinColor('marketplace') }}>
                      {selected.price === 0 ? 'Free' : `₦${(selected.price).toLocaleString()}`}
                    </p>
                  )}
                  {selected.description && (
                    <p className="text-sm font-yrdly-body text-foreground/80 leading-relaxed">
                      {selected.description}
                    </p>
                  )}
                  {selected.attendees !== undefined && selected.type === 'event' && (
                    <div className="flex items-center gap-2 text-sm font-yrdly-body font-medium text-[var(--yrdly-label)]">
                      <Users className="w-4 h-4" /> {selected.attendees} attending
                    </div>
                  )}
                  {selected.date && (
                    <div className="flex items-center gap-2 text-sm font-yrdly-body font-medium text-[var(--yrdly-label)]">
                      <Calendar className="w-4 h-4" /> {new Date(selected.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </div>
                  )}

                  {/* ETA Drive Display */}
                  {(etaLoading || eta) && (
                    <div className="flex items-center gap-2 pt-1.5 border-t border-[var(--yrdly-glass-border)] text-xs font-yrdly-body font-medium text-foreground">
                      <Navigation className="w-4 h-4 text-[#82DB7E]" />
                      {etaLoading ? (
                        <span className="text-[var(--yrdly-label)]">Calculating drive time...</span>
                      ) : (
                        <span>
                          <strong className="font-bold text-[#82DB7E]">{Math.ceil((eta?.duration_in_traffic_seconds ?? 0) / 60)} min drive</strong>
                          <span className="text-[var(--yrdly-label)]"> ({((eta?.distance_meters ?? 0) / 1000).toFixed(1)} km away)</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-4">
                  <a 
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selected.position.lat},${selected.position.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex h-12 rounded-full font-yrdly-body font-bold text-sm bg-accent text-accent-foreground hover:bg-accent/80 items-center justify-center gap-2 transition-colors"
                  >
                    <Navigation className="w-4 h-4" /> Get Directions
                  </a>
                  <Button 
                    className="flex-1 h-12 rounded-full font-yrdly-body font-bold text-sm" 
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

      {/* ── Search + filter overlay ── */}
      <div className="absolute top-4 left-4 right-4 z-10 space-y-2.5 font-yrdly-body">
        {/* Search row */}
        <div className="flex items-center gap-2">
          {/* Back button */}
          <button
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 2) {
                router.back();
              } else {
                router.push('/home');
              }
            }}
            className="flex items-center justify-center w-10 h-10 rounded-full shadow-2xl flex-shrink-0 transition-all hover:scale-105 active:scale-95 bg-[var(--yrdly-dark)]/90 border border-[var(--yrdly-glass-border)] text-foreground backdrop-blur-md"
            aria-label="Go Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div
            className="flex flex-1 items-center gap-2.5 rounded-2xl px-4 py-2.5 shadow-2xl bg-[var(--yrdly-dark)]/90 border border-[var(--yrdly-glass-border)] backdrop-blur-md"
          >
            <Search className="w-4 h-4 flex-shrink-0 text-[#82DB7E]" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search streets, estates, businesses..."
              className="flex-1 bg-transparent border-none outline-none text-xs font-yrdly-body font-medium text-foreground placeholder:text-[var(--yrdly-label)]"
            />
          </div>

          {/* Near Me */}
          <button
            onClick={() => { if (map && userCoords) { map.panTo(userCoords); map.setZoom(15); } else if (navigator.geolocation) { navigator.geolocation.getCurrentPosition(p => { if (map) { map.panTo({ lat: p.coords.latitude, lng: p.coords.longitude }); map.setZoom(15); } }); } }}
            className="flex items-center gap-1.5 rounded-2xl px-3.5 py-2.5 font-yrdly-body font-extrabold text-xs shadow-2xl flex-shrink-0 transition-all hover:scale-105 active:scale-95 bg-[var(--yrdly-dark)]/90 border border-[#82DB7E]/40 text-[#82DB7E] backdrop-blur-md"
          >
            <Locate className="w-3.5 h-3.5" />
            <span>Near Me</span>
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="flex-shrink-0 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-yrdly-body font-bold shadow-lg transition-all hover:scale-105 active:scale-95"
              style={
                activeTab === t.key
                  ? { background: '#82DB7E', color: '#0B0D0B' }
                  : { background: 'rgba(13,17,23,0.85)', backdropFilter: 'blur(16px)', color: 'rgba(255,255,255,0.8)', border: '1px solid var(--yrdly-glass-border)' }
              }
            >
              <span style={{ color: activeTab === t.key ? '#0B0D0B' : t.color }}>{t.icon}</span>
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

      {/* Locate Me Upper Right */}
      <button
        onClick={() => { if (map && userCoords) { map.panTo(userCoords); map.setZoom(15); } }}
        className="absolute top-28 right-4 z-20 flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-yrdly-body font-bold shadow-2xl transition-all hover:scale-105 active:scale-95 bg-[var(--yrdly-dark)]/90 border border-[var(--yrdly-glass-border)] text-foreground backdrop-blur-md"
      >
        <Locate className="w-3.5 h-3.5 text-[#82DB7E]" />
        <span>Locate me</span>
      </button>

      {/* ── Area info card (floating bottom-left 1:1 screenshot) ── */}
      <div
        className="absolute z-20 left-4 rounded-2xl p-4 w-60 shadow-2xl bg-[var(--yrdly-dark)]/90 border border-[var(--yrdly-glass-border)] font-yrdly-body bottom-[170px] backdrop-blur-md"
      >
        <div className="flex items-center gap-1.5 mb-1">
          <MapPin className="w-4 h-4 text-[#82DB7E]" />
          <span className="font-yrdly-display font-black text-base text-foreground">
            {activeFilter?.lga || profile?.home_lga || profile?.location?.state || 'Lagos'}
          </span>
        </div>
        <p className="text-[11px] mb-3 text-[var(--yrdly-label)] font-yrdly-body">
          {markers.filter(m => m.type === 'business').length} businesses
          &nbsp;•&nbsp;
          {markers.filter(m => m.type === 'event').length} events nearby
        </p>
        <button
          onClick={() => router.push('/community' as any)}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-yrdly-body font-extrabold transition-all hover:opacity-90 active:scale-95 bg-[#82DB7E] text-[#0B0D0B]"
        >
          <span>View Community</span>
          <Navigation className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Floating Controls Right (1:1 screenshot) ── */}
      <div className="absolute right-4 z-20 flex flex-col items-end gap-3 bottom-[170px]">
        <button
          onClick={() => setActiveTab(activeTab === 'all' ? 'events' : 'all')}
          className="w-10 h-10 rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-105 active:scale-95 bg-[var(--yrdly-dark)]/90 border border-[var(--yrdly-glass-border)] text-foreground backdrop-blur-md"
          title="Toggle Layers"
        >
          <Layers className="w-4 h-4 text-foreground" />
        </button>
        <button
          onClick={() => router.push('/home' as any)}
          className="flex items-center gap-1.5 rounded-full px-4 py-3 text-xs font-yrdly-body font-extrabold shadow-2xl transition-all hover:scale-105 active:scale-95 bg-[#82DB7E] text-[#0B0D0B]"
        >
          <Plus className="w-4 h-4" />
          <span>Create Post</span>
        </button>
      </div>

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
            className="fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[24px] border-t border-[var(--yrdly-glass-border)] shadow-[0_-20px_40px_rgba(0,0,0,0.5)] transition-all bg-[var(--yrdly-dark)]/90 backdrop-blur-xl font-yrdly-body"
          >
            <div className="w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
              <div className="h-1.5 w-12 rounded-full bg-[var(--yrdly-label)]/30" />
            </div>
            
            <div className="px-5 pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-yrdly-display font-bold text-foreground">Nearby Activity</h2>
                  <p className="text-xs font-yrdly-body font-medium mt-0.5 text-[var(--yrdly-label)]">
                    {visibleMarkers.length} places in this area
                  </p>
                </div>
                <button onClick={() => router.push('/home' as any)} className="text-xs font-yrdly-body font-bold" style={{ color: '#82DB7E' }}>See all ›</button>
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
                  className="w-full rounded-2xl p-3.5 flex items-center gap-4 text-left transition-colors hover:bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)]/50 backdrop-blur-md"
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
                  <div className="flex flex-col flex-1 min-w-0 font-yrdly-body">
                    <p className="text-[0.6rem] font-yrdly-display font-bold uppercase tracking-wider mb-0.5" style={{ color: m.type === 'friend' ? '#8B5CF6' : m.type === 'event' ? '#F59E0B' : m.type === 'business' ? '#22c55e' : '#E6A100' }}>
                      {m.type}
                    </p>
                    <p className="text-sm font-yrdly-display font-bold text-foreground truncate">{m.title}</p>
                    <p className="text-xs font-yrdly-body truncate mt-0.5 text-[var(--yrdly-label)]">{m.distance || m.address}</p>
                  </div>
                  {m.price !== undefined && (
                    <div className="font-yrdly-display font-black text-sm pl-2 flex-shrink-0" style={{ color: getPinColor('marketplace') }}>
                      {m.price === 0 ? 'Free' : `₦${(m.price/1000).toLocaleString()}k`}
                    </div>
                  )}
                </button>
              ))}

              {visibleMarkers.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-10 text-center text-[var(--yrdly-label)] font-yrdly-body">
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