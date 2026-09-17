"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { 
  Search, 
  Navigation, 
  Calendar, 
  Briefcase, 
  Users, 
  MapPin, 
  Locate, 
  ArrowLeft, 
  Car, 
  Tag, 
  MessageSquare, 
  X,
  Layers,
  ChevronRight
} from 'lucide-react';
import { Map, AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useLocation } from '@/contexts/LocationContext';
import { Drawer as VaulDrawer } from 'vaul';
import Supercluster from 'supercluster';
import { cn } from '@/lib/utils';

type FilterType = 'all' | 'marketplace' | 'friends' | 'events' | 'businesses' | 'posts';

type MapMarker = {
  id: string;
  type: 'friend' | 'business' | 'event' | 'marketplace' | 'post';
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  targetId: string;
  avatar_url?: string;
  image?: string;
  price?: number;
};

type ActivityItem = {
  id: string;
  kind: 'post' | 'market' | 'event' | 'biz' | 'friend';
  title: string;
  subtitle: string;
  image?: string;
  time: string;
  meta?: string;
  route: string;
  lat?: number;
  lng?: number;
  price?: number;
};

const FILTERS: {
  key: FilterType;
  label: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  { key: 'all',          label: 'All',         icon: <Layers className="w-3.5 h-3.5" />,        color: '#82DB7E' },
  { key: 'marketplace',  label: 'Marketplace', icon: <Tag className="w-3.5 h-3.5" />,           color: '#82DB7E' },
  { key: 'friends',      label: 'Friends',     icon: <Users className="w-3.5 h-3.5" />,         color: '#82DB7E' },
  { key: 'events',       label: 'Events',      icon: <Calendar className="w-3.5 h-3.5" />,      color: '#82DB7E' },
  { key: 'businesses',   label: 'Businesses',  icon: <Briefcase className="w-3.5 h-3.5" />,     color: '#82DB7E' },
  { key: 'posts',        label: 'Posts',       icon: <MessageSquare className="w-3.5 h-3.5" />, color: '#82DB7E' },
];

const PIN_COLORS: Record<string, string> = {
  friend: '#8B5CF6',
  business: '#3B82F6',
  event: '#F59E0B',
  post: '#82DB7E',
  marketplace: '#82DB7E',
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

const NIGERIA_CENTER = { lat: 6.5244, lng: 3.3792 };

const applyJitter = (lat: number, lng: number, offset = 0.002) => {
  return {
    lat: lat + (Math.random() - 0.5) * offset,
    lng: lng + (Math.random() - 0.5) * offset,
  };
};

function formatTimeOrDate(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  if (diff < 0) {
    const date = new Date(d);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function getDistanceStr(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = R * c;
  if (km < 1) return `${Math.round(km * 1000)}m away`;
  return `${km.toFixed(1)}km away`;
}

function MapLogicOverlay({ setBounds, setZoom }: { setBounds: (b: [number, number, number, number] | null) => void; setZoom: (z: number) => void }) {
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
          b.getNorthEast().lat(),
        ]);
      }
      setZoom(map.getZoom() || 14);
    };
    update();
    const l1 = map.addListener('idle', update);
    return () => { (window as any).google?.maps?.event?.removeListener(l1); };
  }, [map, setBounds, setZoom]);
  return null;
}

interface MapScreenProps { className?: string }

export function MapScreen({ className }: MapScreenProps) {
  const { user, profile } = useAuth();
  const { activeFilter } = useLocation();
  const router = useRouter();
  const map = useMap();

  const [allMarkers, setAllMarkers]   = useState<MapMarker[]>([]);
  const [activity, setActivity]       = useState<ActivityItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filter, setFilter]           = useState<FilterType>('all');
  const [showsTraffic, setShowsTraffic] = useState(false);
  const [selectedPin, setSelectedPin] = useState<MapMarker | null>(null);
  const [search, setSearch]           = useState('');
  const [showSearch, setShowSearch]   = useState(false);
  const [userCoords, setUserCoords]   = useState<{ lat: number; lng: number } | null>(null);
  const [eta, setEta]                 = useState<{ duration_seconds: number; duration_in_traffic_seconds: number; distance_meters: number } | null>(null);
  const [etaLoading, setEtaLoading]   = useState(false);

  // Supercluster tracking
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(null);
  const [zoom, setZoom]     = useState(14);
  const [clusters, setClusters] = useState<ReturnType<typeof supercluster.getClusters>>([]);

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
    if (!selectedPin || !userCoords) {
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
            destination: { lat: selectedPin.lat, lng: selectedPin.lng },
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
  }, [selectedPin, userCoords]);

  // Fetch markers matching mobile implementation
  useEffect(() => {
    const fetchMarkers = async () => {
      setLoading(true);
      const found: MapMarker[] = [];

      const filterState = activeFilter?.state || profile?.home_state;
      const filterLga   = activeFilter?.lga   || profile?.home_lga;

      // 1. Friends
      if (user?.id) {
        const { data: me } = await supabase
          .from('users')
          .select('friends')
          .eq('id', user.id)
          .single();

        if (me?.friends && me.friends.length > 0) {
          const { data: frds } = await supabase
            .from('users')
            .select('id, name, avatar_url, current_location')
            .in('id', me.friends)
            .or('share_location.is.null,share_location.eq.true')
            .not('current_location', 'is', null);

          (frds || []).forEach((f: any) => {
            const lat = parseFloat(f.current_location?.lat ?? f.current_location?.geopoint?.latitude);
            const lng = parseFloat(f.current_location?.lng ?? f.current_location?.geopoint?.longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
              const jittered = applyJitter(lat, lng);
              found.push({
                id: `friend-${f.id}`,
                type: 'friend',
                lat: jittered.lat,
                lng: jittered.lng,
                title: f.name || 'Friend',
                subtitle: 'Friend',
                targetId: f.id,
                avatar_url: f.avatar_url,
              });
            }
          });
        }
      }

      // 2. Events (events table)
      let qNewEvts = supabase
        .from('events')
        .select('id,title,location_address,cover_image_url,lat,lng')
        .eq('status', 'PUBLISHED')
        .neq('is_archived', true)
        .not('lat', 'is', null)
        .not('lng', 'is', null);
      if (filterLga)   qNewEvts = qNewEvts.eq('lga', filterLga);
      else if (filterState) qNewEvts = qNewEvts.eq('state', filterState);
      const { data: newEvts } = await qNewEvts.limit(50);
      (newEvts || []).forEach((e: any) => {
        const lat = parseFloat(e.lat);
        const lng = parseFloat(e.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          found.push({
            id: `nevt-${e.id}`,
            type: 'event',
            lat,
            lng,
            title: e.title || 'Event',
            subtitle: e.location_address || 'Event',
            targetId: e.id,
            avatar_url: e.cover_image_url,
            image: e.cover_image_url,
          });
        }
      });

      // 3. Businesses
      let qBiz = supabase
        .from('businesses')
        .select('id,name,location,image_urls,lat,lng')
        .eq('is_active', true);
      if (filterLga)   qBiz = qBiz.eq('lga', filterLga);
      else if (filterState) qBiz = qBiz.eq('state', filterState);
      const { data: businesses } = await qBiz.limit(50);
      (businesses || []).forEach((b: any) => {
        const lat = parseFloat(b.lat ?? b.location?.lat);
        const lng = parseFloat(b.lng ?? b.location?.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          found.push({
            id: `biz-${b.id}`,
            type: 'business',
            lat,
            lng,
            title: b.name || 'Business',
            subtitle: b.location?.address || 'Local Business',
            targetId: b.id,
            avatar_url: b.image_urls?.[0],
            image: b.image_urls?.[0],
          });
        }
      });

      // 4. Marketplace items
      let qMkt = supabase
        .from('posts')
        .select('id,title,price,image_urls,event_location,lat,lng,location_address')
        .eq('category', 'For Sale')
        .or('is_sold.eq.false,is_sold.is.null')
        .not('lat', 'is', null)
        .not('lng', 'is', null);
      if (filterLga)   qMkt = qMkt.eq('lga', filterLga);
      else if (filterState) qMkt = qMkt.eq('state', filterState);
      const { data: mkt } = await qMkt.limit(30);
      (mkt || []).forEach((p: any) => {
        const lat = parseFloat(p.lat ?? p.event_location?.lat);
        const lng = parseFloat(p.lng ?? p.event_location?.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          const jittered = applyJitter(lat, lng);
          found.push({
            id: `mkt-${p.id}`,
            type: 'marketplace',
            lat: jittered.lat,
            lng: jittered.lng,
            title: p.title || 'Item for Sale',
            subtitle: p.price ? `₦${Number(p.price).toLocaleString()}` : p.location_address || 'Nearby Item',
            price: p.price,
            targetId: p.id,
            avatar_url: p.image_urls?.[0],
            image: p.image_urls?.[0],
          });
        }
      });

      setAllMarkers(found);
      setLoading(false);
    };

    fetchMarkers();
  }, [user?.id, activeFilter?.lga, activeFilter?.state, profile?.home_state, profile?.home_lga]);

  const visibleMarkers = useMemo(() => {
    const byFilter =
      filter === 'all'
        ? allMarkers
        : allMarkers.filter((m) => {
            if (filter === 'friends') return m.type === 'friend';
            if (filter === 'events') return m.type === 'event';
            if (filter === 'businesses') return m.type === 'business';
            if (filter === 'marketplace') return m.type === 'marketplace';
            if (filter === 'posts') return m.type === 'post';
            return true;
          });
    if (!search.trim()) return byFilter;
    const q = search.toLowerCase();
    return byFilter.filter(
      (m) => m.title.toLowerCase().includes(q) || (m.subtitle || '').toLowerCase().includes(q)
    );
  }, [allMarkers, filter, search]);

  // Load supercluster
  useEffect(() => {
    const points = visibleMarkers.map((m) => ({
      type: 'Feature' as const,
      properties: { cluster: false, ...m },
      geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
    }));
    supercluster.load(points);
    if (bounds) {
      setClusters(supercluster.getClusters(bounds, zoom));
    }
  }, [visibleMarkers, supercluster, bounds, zoom]);

  const areaName = activeFilter?.lga || activeFilter?.state || profile?.home_lga || profile?.home_state || 'Your Area';

  const locateMe = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserCoords(coords);
        if (map) {
          map.panTo(coords);
          map.setZoom(15);
        }
      });
    } else if (userCoords && map) {
      map.panTo(userCoords);
      map.setZoom(15);
    }
  }, [map, userCoords]);

  return (
    <div className={cn("relative w-full overflow-hidden bg-[#0d1117] text-white font-yrdly-body h-[100dvh]", className)}>
      
      {/* ── GOOGLE MAP ── */}
      <Map
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"}
        defaultCenter={userCoords ?? NIGERIA_CENTER}
        defaultZoom={userCoords ? 14 : 11}
        gestureHandling="greedy"
        disableDefaultUI
        styles={DARK_MAP_STYLES}
        className="w-full h-full absolute inset-0"
      >
        <MapLogicOverlay setBounds={setBounds} setZoom={setZoom} />

        {/* User Location Pulsing Blue Dot */}
        {userCoords && (
          <AdvancedMarker position={userCoords} zIndex={100}>
            <div className="relative flex items-center justify-center">
              <div className="absolute w-12 h-12 bg-blue-500/25 rounded-full animate-ping" />
              <div className="absolute w-7 h-7 bg-blue-500/40 rounded-full animate-pulse" />
              <div className="relative w-3.5 h-3.5 bg-blue-500 rounded-full border-2 border-white shadow-md" />
            </div>
          </AdvancedMarker>
        )}

        {/* Clusters & Custom Mobile Markers */}
        {clusters.map((cluster) => {
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
                <div className="w-11 h-11 rounded-full bg-[#82DB7E] text-[#0B0D0B] font-yrdly-display font-extrabold text-sm flex items-center justify-center border-3 border-white shadow-2xl transition-transform hover:scale-110">
                  {point_count}
                </div>
              </AdvancedMarker>
            );
          }

          const m = cluster.properties as unknown as MapMarker;
          const isSelected = selectedPin?.id === m.id;

          return (
            <AdvancedMarker
              key={m.id}
              position={{ lat: m.lat, lng: m.lng }}
              onClick={() => setSelectedPin(isSelected ? null : m)}
            >
              <div className="flex flex-col items-center cursor-pointer group transition-transform duration-200 hover:scale-110">
                {/* Friend Marker: Purple ring around avatar + purple dot */}
                {m.type === 'friend' ? (
                  <div className="flex flex-col items-center">
                    <div className="w-[44px] h-[44px] rounded-full border-[2.5px] border-[#8B5CF6] overflow-hidden bg-[#1a1a2e] shadow-xl flex items-center justify-center">
                      {m.avatar_url ? (
                        <Image src={m.avatar_url} alt="" width={40} height={40} className="w-full h-full object-cover rounded-full" />
                      ) : (
                        <Users className="w-5 h-5 text-white" />
                      )}
                    </div>
                    <div className="w-2 h-2 rounded-full bg-[#8B5CF6] mt-0.5 shadow-md" />
                  </div>
                ) : m.type === 'business' ? (
                  /* Business Marker: 40x40 rounded box + blue dot */
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(59,130,246,0.15)] border border-[rgba(255,255,255,0.12)] backdrop-blur-md flex items-center justify-center shadow-xl">
                      <Briefcase className="w-4 h-4 text-[#3B82F6]" />
                    </div>
                    <div className="w-2 h-2 rounded-full bg-[#3B82F6] mt-0.5 shadow-md" />
                  </div>
                ) : m.type === 'marketplace' ? (
                  /* Marketplace Marker: 40x40 rounded box + green dot */
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(130,219,126,0.15)] border border-[rgba(255,255,255,0.12)] backdrop-blur-md flex items-center justify-center shadow-xl">
                      <Tag className="w-4 h-4 text-[#82DB7E]" />
                    </div>
                    <div className="w-2 h-2 rounded-full bg-[#82DB7E] mt-0.5 shadow-md" />
                  </div>
                ) : (
                  /* Event / Post Marker: 40x40 rounded box + amber dot */
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-xl bg-[rgba(245,158,11,0.15)] border border-[rgba(255,255,255,0.12)] backdrop-blur-md flex items-center justify-center shadow-xl">
                      <Calendar className="w-4 h-4 text-[#F59E0B]" />
                    </div>
                    <div className="w-2 h-2 rounded-full bg-[#F59E0B] mt-0.5 shadow-md" />
                  </div>
                )}
              </div>
            </AdvancedMarker>
          );
        })}
      </Map>

      {/* ── TOP OVERLAYS (Matches Mobile Header 1:1) ── */}
      <div className="absolute top-0 left-0 right-0 z-20 pt-4 px-4 space-y-3 pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          {/* Back Button */}
          <button
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 2) {
                router.back();
              } else {
                router.push('/home');
              }
            }}
            className="w-9 h-9 rounded-full bg-[rgba(0,0,0,0.6)] border border-[rgba(255,255,255,0.12)] backdrop-blur-md flex items-center justify-center text-white shadow-lg transition-transform active:scale-95 flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          {/* Location Pill or Expandable Search Input */}
          {showSearch ? (
            <div className="flex-1 flex items-center gap-2 bg-[rgba(0,0,0,0.75)] border border-[rgba(255,255,255,0.15)] rounded-2xl px-3.5 py-1.5 backdrop-blur-md shadow-lg">
              <Search className="w-4 h-4 text-[#82DB7E] flex-shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search map..."
                autoFocus
                className="flex-1 bg-transparent border-none outline-none text-xs text-white placeholder:text-neutral-400 font-medium"
              />
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearch('');
                }}
                className="text-neutral-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div 
              onClick={() => setShowSearch(true)}
              className="flex-1 flex items-center bg-[rgba(0,0,0,0.6)] border border-[rgba(255,255,255,0.12)] rounded-2xl px-3.5 py-2 backdrop-blur-md shadow-lg cursor-pointer hover:bg-[rgba(0,0,0,0.75)] transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-[#82DB7E] flex-shrink-0" />
              <span className="text-xs font-semibold text-white ml-2 truncate font-yrdly-display">
                {areaName}
              </span>
            </div>
          )}

          {/* Search Trigger Button (when search bar hidden) */}
          {!showSearch && (
            <button
              onClick={() => setShowSearch(true)}
              className="w-9 h-9 rounded-full bg-[rgba(0,0,0,0.6)] border border-[rgba(255,255,255,0.12)] backdrop-blur-md flex items-center justify-center text-white/80 shadow-lg transition-transform active:scale-95 flex-shrink-0"
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter Chips Bar (Horizontal Scroll 1:1 Mobile) */}
        <div className="flex gap-2 overflow-x-auto pb-1 pointer-events-auto" style={{ scrollbarWidth: 'none' }}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-1.5 px-3.5 h-7 rounded-full text-xs font-medium transition-all shadow-md active:scale-95",
                  active
                    ? "bg-[#82DB7E] text-[#0B0D0B] font-bold"
                    : "bg-[rgba(0,0,0,0.55)] border border-[rgba(255,255,255,0.12)] text-white/70 backdrop-blur-md hover:text-white"
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── FLOATING CONTROLS (Right Side 1:1 Mobile) ── */}
      <div 
        className={cn(
          "absolute right-4 z-20 flex flex-col items-end gap-3 transition-all duration-300 pointer-events-auto",
          selectedPin ? "bottom-[230px]" : "bottom-[160px]"
        )}
      >
        {/* Traffic Switch Toggle */}
        <div className="flex items-center gap-2 bg-[#101418]/90 border border-[rgba(255,255,255,0.12)] backdrop-blur-md rounded-full pl-3 pr-2 py-1.5 shadow-xl">
          <Car className="w-4 h-4 text-white/80" />
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              checked={showsTraffic} 
              onChange={(e) => setShowsTraffic(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-8 h-4 bg-white/20 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#82DB7E]" />
          </label>
        </div>

        {/* Recenter / Locate Me Button */}
        <button
          onClick={locateMe}
          title="Locate me"
          className="w-11 h-11 rounded-full bg-[rgba(0,0,0,0.75)] border border-[rgba(255,255,255,0.12)] backdrop-blur-md flex items-center justify-center text-white/90 shadow-2xl transition-transform active:scale-95 hover:scale-105"
        >
          <Locate className="w-5 h-5 text-[#82DB7E]" />
        </button>
      </div>

      {/* ── PIN PREVIEW BOTTOM SHEET (When Pin Selected - 1:1 Mobile) ── */}
      {selectedPin && (
        <div className="absolute bottom-0 left-0 right-0 z-30 bg-[#161c24] border-t border-[rgba(255,255,255,0.12)] rounded-t-[24px] p-5 pt-3 shadow-[0_-20px_40px_rgba(0,0,0,0.6)] backdrop-blur-xl animate-in slide-in-from-bottom duration-200">
          {/* Top Handle Bar */}
          <div className="w-9 h-1 rounded-full bg-white/20 mx-auto mb-4" />

          {/* Close button top right */}
          <button 
            onClick={() => setSelectedPin(null)} 
            className="absolute top-4 right-4 text-neutral-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3.5">
            {/* Image / Avatar Box */}
            <div className="w-[72px] h-[72px] rounded-2xl overflow-hidden bg-[#101418] border border-[rgba(255,255,255,0.1)] flex-shrink-0 relative flex items-center justify-center shadow-md">
              {selectedPin.image || selectedPin.avatar_url ? (
                <Image 
                  src={(selectedPin.image || selectedPin.avatar_url)!} 
                  alt="" 
                  fill 
                  className="object-cover" 
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-[#1a1a2e]">
                  {selectedPin.type === 'event' && <Calendar className="w-6 h-6 text-[#F59E0B]" />}
                  {selectedPin.type === 'business' && <Briefcase className="w-6 h-6 text-[#3B82F6]" />}
                  {selectedPin.type === 'friend' && <Users className="w-6 h-6 text-[#8B5CF6]" />}
                  {selectedPin.type === 'marketplace' && <Tag className="w-6 h-6 text-[#82DB7E]" />}
                </div>
              )}
            </div>

            {/* Info details */}
            <div className="flex-1 min-w-0 pr-6">
              <div className="inline-block px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider mb-1.5 border"
                style={{
                  backgroundColor: `${PIN_COLORS[selectedPin.type]}18`,
                  borderColor: `${PIN_COLORS[selectedPin.type]}40`,
                  color: PIN_COLORS[selectedPin.type],
                }}
              >
                {selectedPin.type}
              </div>
              <h3 className="text-base font-bold text-white truncate font-yrdly-display leading-snug">
                {selectedPin.title}
              </h3>
              <p className="text-xs text-neutral-400 truncate mt-0.5 font-yrdly-body">
                {selectedPin.subtitle}
              </p>

              {/* ETA Display */}
              {(etaLoading || eta || (userCoords && selectedPin)) && (
                <div className="flex items-center gap-1.5 mt-2 text-xs">
                  <Car className="w-3.5 h-3.5 text-neutral-400" />
                  {etaLoading ? (
                    <span className="text-neutral-400">Calculating ETA...</span>
                  ) : eta ? (
                    <span className="font-semibold text-white">
                      {Math.ceil((eta.duration_in_traffic_seconds || eta.duration_seconds || 0) / 60)} min drive
                      <span className="text-neutral-400 font-normal"> · {((eta.distance_meters || 0) / 1000).toFixed(1)} km</span>
                    </span>
                  ) : userCoords ? (
                    <span className="text-neutral-400">
                      {getDistanceStr(userCoords.lat, userCoords.lng, selectedPin.lat, selectedPin.lng)}
                    </span>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {/* Action button full width */}
          <button
            onClick={() => {
              if (selectedPin.type === 'friend') router.push(`/profile/${selectedPin.targetId}`);
              else if (selectedPin.type === 'event') router.push(`/events/${selectedPin.targetId}`);
              else if (selectedPin.type === 'business') router.push(`/businesses/${selectedPin.targetId}`);
              else if (selectedPin.type === 'marketplace') router.push(`/marketplace/${selectedPin.targetId}`);
              setSelectedPin(null);
            }}
            className="w-full mt-4 py-3 rounded-xl bg-[#82DB7E] hover:bg-[#72cb6e] text-[#0B0D0B] font-extrabold text-sm font-yrdly-display transition-colors active:scale-[0.99] flex items-center justify-center gap-1.5 shadow-lg"
          >
            <span>
              View {selectedPin.type === 'friend' ? 'Profile' : selectedPin.type === 'event' ? 'Event' : selectedPin.type === 'business' ? 'Business' : 'Item'}
            </span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── EXPANDABLE BOTTOM SHEET (When No Pin Selected - 1:1 Mobile Activity Feed) ── */}
      {!selectedPin && (
        <VaulDrawer.Root 
          snapPoints={[140, 420, '0.85']} 
          activeSnapPoint={140} 
          setActiveSnapPoint={() => {}} 
          modal={false} 
          open={true} 
          dismissible={false}
        >
          <VaulDrawer.Portal>
            <VaulDrawer.Content 
              className="fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[24px] border-t border-[rgba(255,255,255,0.12)] shadow-[0_-20px_40px_rgba(0,0,0,0.5)] transition-all bg-[#0d1117]/95 backdrop-blur-xl font-yrdly-body"
            >
              <div className="w-full flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
                <div className="h-1 w-9 rounded-full bg-white/20" />
              </div>
              
              <div className="px-5 pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold font-yrdly-display text-white">Nearby Activity</h2>
                    <p className="text-xs text-neutral-400 font-medium mt-0.5">
                      {visibleMarkers.length} places in this area
                    </p>
                  </div>
                  <button onClick={() => router.push('/home')} className="text-xs font-bold text-[#82DB7E]">
                    See all ›
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-8 space-y-2.5" style={{ scrollbarWidth: 'none' }}>
                {visibleMarkers.slice(0, 20).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelectedPin(m);
                      if (map) { map.panTo({ lat: m.lat, lng: m.lng }); map.setZoom(16); }
                    }}
                    className="w-full rounded-2xl p-3 flex items-center gap-3.5 text-left transition-colors hover:bg-white/5 border border-white/5 bg-white/[0.03] backdrop-blur-md"
                  >
                    <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 relative shadow-sm bg-[#1a1a2e]">
                      {m.image || m.avatar_url ? (
                        <Image src={(m.image || m.avatar_url)!} alt="" fill className="object-cover" sizes="48px" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          {m.type === 'event' && <Calendar className="w-5 h-5 text-[#F59E0B]" />}
                          {m.type === 'business' && <Briefcase className="w-5 h-5 text-[#3B82F6]" />}
                          {m.type === 'friend' && <Users className="w-5 h-5 text-[#8B5CF6]" />}
                          {m.type === 'marketplace' && <Tag className="w-5 h-5 text-[#82DB7E]" />}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col flex-1 min-w-0 font-yrdly-body">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider mb-0.5" style={{ color: PIN_COLORS[m.type] || '#82DB7E' }}>
                        {m.type}
                      </span>
                      <p className="text-xs font-bold text-white truncate font-yrdly-display">{m.title}</p>
                      <p className="text-[11px] text-neutral-400 truncate mt-0.5">{m.subtitle || 'Nearby'}</p>
                    </div>
                    {m.price !== undefined && (
                      <div className="font-yrdly-display font-extrabold text-xs text-[#82DB7E] pl-2 flex-shrink-0">
                        {m.price === 0 ? 'Free' : `₦${(m.price).toLocaleString()}`}
                      </div>
                    )}
                  </button>
                ))}

                {visibleMarkers.length === 0 && !loading && (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-neutral-400 font-yrdly-body">
                    <Navigation className="w-7 h-7 mb-2 opacity-50 text-[#82DB7E]" />
                    <p className="text-xs font-medium">No places found in this view.</p>
                    <p className="text-[11px] mt-1 text-neutral-500">Pan or zoom the map to explore.</p>
                  </div>
                )}
              </div>
            </VaulDrawer.Content>
          </VaulDrawer.Portal>
        </VaulDrawer.Root>
      )}

      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0d1117]/80 backdrop-blur-sm">
          <div className="w-10 h-10 border-3 border-[#82DB7E] border-t-transparent animate-spin rounded-full mb-3" />
          <span className="text-xs font-semibold text-[#82DB7E]">Locating area...</span>
        </div>
      )}
    </div>
  );
}