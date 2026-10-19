"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import states from "@/data/states.json";
import { useRouter } from "next/navigation";
import {
  AdvancedMarker,
  Map,
  useApiLoadingStatus,
  useMap,
} from "@vis.gl/react-google-maps";
import {
  ArrowLeft,
  Calendar,
  Car,
  ChevronDown,
  ChevronUp,
  Locate,
  MapPin,
  Search,
  Store,
  Tag,
  Users,
  X,
} from "lucide-react";
import Supercluster from "supercluster";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";
import { supabase } from "@/lib/supabase/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useLocation } from "@/contexts/LocationContext";
import { cn } from "@/lib/shared/utils";
import {
  coordinates,
  mappableRowsFilter,
  normalizeEta,
  filterMarkers,
  loadMapSources,
  markerRoute,
  MARKER_COLORS,
  MARKER_LABELS,
  type MapFilter,
  type MapMarker,
  type MapSource,
} from "@/lib/location/map-model";

const DEFAULT_CENTER = { lat: 6.5244, lng: 3.3792 };
const FILTERS: { key: MapFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "marketplace", label: "Marketplace" },
  { key: "friend", label: "Friends" },
  { key: "event", label: "Events" },
  { key: "business", label: "Businesses" },
];
const ICONS = {
  marketplace: Tag,
  event: Calendar,
  business: Store,
  friend: Users,
};
const control =
  "flex min-h-11 min-w-11 items-center justify-center rounded-2xl border border-white/15 bg-[#14231B] text-white shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#82DB7E]";

function PlacePhoto({ marker }: { marker: MapMarker }) {
  const [failed, setFailed] = useState<string>();
  return marker.image && failed !== marker.image ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={marker.image}
      alt=""
      onError={() => setFailed(marker.image)}
      className="h-20 w-20 shrink-0 rounded-2xl object-cover"
    />
  ) : (
    <MarkerToken marker={marker} selected />
  );
}

function MarkerToken({
  marker,
  selected = false,
}: {
  marker: MapMarker;
  selected?: boolean;
}) {
  const [failed, setFailed] = useState<string>();
  const Icon = ICONS[marker.type];
  const friend = marker.type === "friend";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden border-2 shadow-[0_3px_10px_#0006] ring-1 ring-[#F2F5E8]/70",
        friend ? "rounded-full" : "rounded-[14px]",
        selected ? "h-11 w-11 ring-2" : "h-10 w-10",
      )}
      style={{
        background: selected ? "#82DB7E" : "#14231B",
        color: selected ? "#0B0D0B" : MARKER_COLORS[marker.type],
        borderColor: selected ? "#F2F5E8" : MARKER_COLORS[marker.type],
      }}
    >
      {friend && marker.image && failed !== marker.image ? (
        // Map avatars may include legacy remote hosts; a failed image falls back to the category icon.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={marker.image}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(marker.image)}
        />
      ) : (
        <Icon size={20} aria-hidden="true" />
      )}
    </span>
  );
}

export function MapScreen({ className }: { className?: string }) {
  const { user } = useAuth();
  const { activeFilter, displayLabel, setGlobalFilter, userProfileLocation } =
    useLocation();
  const router = useRouter();
  const map = useMap();
  const apiStatus = useApiLoadingStatus();
  const [markers, setMarkers] = useState<MapMarker[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const revision = useRef(0);
  const [filter, setFilter] = useState<MapFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resultsOpen, setResultsOpen] = useState(false);
  const [showsTraffic, setShowsTraffic] = useState(false);
  const [userCoords, setUserCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [pendingCenter, setPendingCenter] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [locationError, setLocationError] = useState("");
  const [locating, setLocating] = useState(false);
  const locationRevision = useRef(0);
  const cameraSet = useRef(false);
  const cameraInteraction = useRef(0);
  const lastArea = useRef<string | null>(null);
  const previewRef = useRef<HTMLHeadingElement>(null);
  const resultToggleRef = useRef<HTMLButtonElement>(null);
  const focusOrigin = useRef<string | null>(null);
  const restoreFocus = useRef(false);
  const [resultAnnouncement, setResultAnnouncement] = useState("");
  const [bounds, setBounds] = useState<[number, number, number, number] | null>(
    null,
  );
  const [zoom, setZoom] = useState(11);
  const [eta, setEta] = useState<{
    duration_seconds: number;
    duration_in_traffic_seconds: number;
    distance_meters: number;
  } | null>(null);
  const [etaStatus, setEtaStatus] = useState<"idle" | "loading" | "error">(
    "idle",
  );

  const requestLocation = useCallback((recenter = true) => {
    const interaction = cameraInteraction.current;
    const current = ++locationRevision.current;
    if (!navigator.geolocation) {
      setLocationError(
        "Location is unavailable in this browser. You can still explore results.",
      );
      return;
    }
    setLocating(true);
    setLocationError("");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (current !== locationRevision.current) return;
        const point = coordinates(
          position.coords.latitude,
          position.coords.longitude,
        );
        if (point) {
          setUserCoords(point);
          if (
            cameraInteraction.current === interaction &&
            (recenter || !cameraSet.current)
          )
            setPendingCenter(point);
        }
        setLocating(false);
      },
      (error) => {
        if (current !== locationRevision.current) return;
        setLocating(false);
        setLocationError(
          error.code === 1
            ? "Location access is off. Enable it in browser settings or explore the selected area."
            : "We couldn't find your location. You can still explore the selected area.",
        );
      },
      { timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => {
    const current = ++revision.current;
    setLoading(true);
    setSelectedId(null);
    const areaKey = JSON.stringify([activeFilter?.state, activeFilter?.lga]);
    if (lastArea.current !== areaKey) {
      cameraSet.current = false;
      cameraInteraction.current++;
      lastArea.current = areaKey;
    }
    const area = <T,>(query: T): T => {
      type Filterable = { eq: (column: string, value: string) => unknown };
      let result = query;
      if (activeFilter?.state)
        result = (result as Filterable).eq("state", activeFilter.state) as T;
      if (activeFilter?.lga)
        result = (result as Filterable).eq("lga", activeFilter.lga) as T;
      return result;
    };
    const sources: MapSource[] = [
      {
        key: "event",
        label: "Events",
        kind: "event",
        load: () =>
          area(
            supabase
              .from("events")
              .select("id,title,location_address,cover_image_url,lat,lng")
              .eq("status", "PUBLISHED")
              .neq("is_archived", true)
              .gte("lat", -90)
              .lte("lat", 90)
              .gte("lng", -180)
              .lte("lng", 180),
          ).limit(50),
      },
      {
        key: "business",
        label: "Businesses",
        kind: "business",
        load: () =>
          area(
            supabase
              .from("businesses")
              .select("id,name,location,image_urls,lat,lng")
              .eq("is_active", true)
              .or(mappableRowsFilter("location")),
          ).limit(50),
      },
      {
        key: "marketplace",
        label: "Marketplace",
        kind: "marketplace",
        load: () =>
          area(
            supabase
              .from("posts")
              .select(
                "id,title,price,image_urls,image_url,video_thumbnail_url,event_location,lat,lng,location_address",
              )
              .eq("category", "For Sale")
              .or("is_sold.eq.false,is_sold.is.null")
              .or(mappableRowsFilter("event_location")),
          ).limit(30),
      },
    ];
    if (user?.id)
      sources.push({
        key: "friend",
        label: "Friends",
        kind: "friend",
        load: () => authenticatedFetch("/api/profiles/friend-locations", {}),
      });
    void loadMapSources(sources, true)
      .then((result) => {
        if (current !== revision.current) return;
        setMarkers(result.markers);
        setFailedSources(result.failedSources);
      })
      .finally(() => {
        if (current === revision.current) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [user?.id, activeFilter?.state, activeFilter?.lga, retry]);

  useEffect(() => {
    requestLocation(false);
    return () => {
      locationRevision.current++;
    };
  }, [requestLocation]);

  const visibleMarkers = useMemo(
    () => filterMarkers(markers, filter, search),
    [markers, filter, search],
  );
  const selectedPin =
    visibleMarkers.find((marker) => marker.id === selectedId) || null;
  useEffect(() => {
    if (selectedPin) previewRef.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      const origin = focusOrigin.current
        ? document.getElementById(focusOrigin.current)
        : null;
      (origin || resultToggleRef.current)?.focus();
    }
  }, [selectedPin?.id]);
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(
      () =>
        setResultAnnouncement(
          `${visibleMarkers.length} results in ${displayLabel}`,
        ),
      350,
    );
    return () => clearTimeout(timer);
  }, [loading, visibleMarkers.length, displayLabel]);
  const closePreview = () => {
    restoreFocus.current = true;
    setSelectedId(null);
  };
  const openPreview = (marker: MapMarker, origin: string) => {
    focusOrigin.current = origin;
    setSelectedId(marker.id);
    cameraSet.current = true;
    cameraInteraction.current++;
  };
  useEffect(() => {
    if (selectedId && !selectedPin) setSelectedId(null);
  }, [selectedId, selectedPin]);

  useEffect(() => {
    if (!map || !pendingCenter) return;
    map.panTo(pendingCenter);
    map.setZoom(14);
    cameraSet.current = true;
    setPendingCenter(null);
  }, [map, pendingCenter]);
  useEffect(() => {
    if (!map || loading || cameraSet.current) return;
    cameraSet.current = true;
    const places = markers.filter((marker) => marker.type !== "friend");
    if (places.length) {
      const box = new google.maps.LatLngBounds();
      places.forEach((marker) => box.extend(marker));
      map.fitBounds(box, 90);
      if (places.length === 1) map.setZoom(14);
    }
  }, [map, loading, markers]);
  useEffect(() => {
    if (!map || !showsTraffic) return;
    const traffic = new google.maps.TrafficLayer();
    traffic.setMap(map);
    return () => traffic.setMap(null);
  }, [map, showsTraffic]);

  useEffect(() => {
    setEta(null);
    setEtaStatus("idle");
    if (!selectedPin || selectedPin.type === "friend" || !userCoords) return;
    const controller = new AbortController();
    setEtaStatus("loading");
    const timer = setTimeout(() => controller.abort(), 8000);
    void fetch("/api/directions/eta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin: userCoords,
        destination: { lat: selectedPin.lat, lng: selectedPin.lng },
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Unavailable");
        return response.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          const validEta = normalizeEta(data);
          if (!validEta) throw new Error("Invalid drive time");
          setEta(validEta);
          setEtaStatus("idle");
        }
      })
      .catch(() => {
        if (!disposed) setEtaStatus("error");
      })
      .finally(() => clearTimeout(timer));
    let disposed = false;
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [selectedPin, userCoords]);

  const clusterIndex = useMemo(() => {
    const index = new Supercluster<{ marker: MapMarker }>({
      radius: 60,
      maxZoom: 16,
    });
    index.load(
      visibleMarkers.map((marker) => ({
        type: "Feature",
        properties: { marker },
        geometry: { type: "Point", coordinates: [marker.lng, marker.lat] },
      })),
    );
    return index;
  }, [visibleMarkers]);
  const clusters = useMemo(
    () => (bounds ? clusterIndex.getClusters(bounds, Math.round(zoom)) : []),
    [clusterIndex, bounds, zoom],
  );
  const selectMarker = (marker: MapMarker) => {
    openPreview(marker, `result-${marker.id}`);
    map?.panTo(marker);
    map?.setZoom(Math.max(15, map.getZoom() || 0));
  };
  const apiFailed = apiStatus === "FAILED" || apiStatus === "AUTH_FAILURE";

  return (
    <div
      className={cn(
        "relative h-[100dvh] w-full overflow-hidden bg-[#E8EDE7] font-yrdly-body",
        className,
      )}
    >
      <Map
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"}
        defaultCenter={DEFAULT_CENTER}
        defaultZoom={11}
        gestureHandling="greedy"
        disableDefaultUI
        className="absolute inset-0 h-full w-full"
        onDragstart={() => {
          cameraSet.current = true;
          cameraInteraction.current++;
          setPendingCenter(null);
        }}
        onCameraChanged={(event) => {
          const b = event.detail.bounds;
          setBounds([b.west, b.south, b.east, b.north]);
          setZoom(event.detail.zoom);
        }}
      >
        {userCoords && (
          <AdvancedMarker
            position={userCoords}
            title="Your location"
            anchorLeft="-50%"
            anchorTop="-50%"
          >
            <span className="block h-4 w-4 rounded-full border-[3px] border-white bg-blue-600 shadow-md" />
          </AdvancedMarker>
        )}
        {clusters.map((cluster) => {
          const [lng, lat] = cluster.geometry.coordinates;
          if ("cluster" in cluster.properties && cluster.properties.cluster) {
            const count = cluster.properties.point_count;
            return (
              <AdvancedMarker
                key={`cluster-${cluster.id}`}
                position={{ lat, lng }}
                anchorLeft="-50%"
                anchorTop="-50%"
                title={`${count} results. Zoom in to explore`}
              >
                <button
                  type="button"
                  aria-label={`${count} results. Zoom in to explore`}
                  onClick={() => {
                    cameraSet.current = true;
                    cameraInteraction.current++;
                    map?.setZoom(
                      clusterIndex.getClusterExpansionZoom(
                        cluster.id as number,
                      ),
                    );
                    map?.panTo({ lat, lng });
                  }}
                  className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-[#F2F5E8] bg-[#82DB7E] text-base font-extrabold text-[#0B0D0B] shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14231B]"
                >
                  {count}
                </button>
              </AdvancedMarker>
            );
          }
          const marker = cluster.properties.marker as MapMarker;
          const selected = marker.id === selectedId;
          return (
            <AdvancedMarker
              key={marker.id}
              position={marker}
              anchorLeft="-50%"
              anchorTop="-50%"
              zIndex={selected ? 100 : 1}
              title={`${MARKER_LABELS[marker.type]}: ${marker.title}`}
            >
              <button
                type="button"
                aria-label={`${MARKER_LABELS[marker.type]}: ${marker.title}`}
                id={`marker-${marker.id}`}
                aria-pressed={selected}
                className="flex h-12 w-12 items-center justify-center rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14231B]"
                onClick={() =>
                  selected
                    ? closePreview()
                    : openPreview(marker, `marker-${marker.id}`)
                }
              >
                <MarkerToken marker={marker} selected={selected} />
              </button>
            </AdvancedMarker>
          );
        })}
      </Map>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 space-y-2 p-3 sm:p-5">
        <div className="pointer-events-auto flex max-w-xl items-center gap-2">
          <button
            type="button"
            className={control}
            aria-label="Back"
            onClick={() =>
              window.history.length > 2 ? router.back() : router.push("/home")
            }
          >
            <ArrowLeft size={19} />
          </button>
          <div className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-[#14231B] px-4 py-2 text-white shadow-lg">
            <h1 className="font-yrdly-display text-base font-bold">
              Explore nearby
            </h1>
            <select
              aria-label="Choose map area"
              value={
                activeFilter?.lga ? "current-area" : activeFilter?.state || ""
              }
              onChange={(event) => {
                const value = event.target.value;
                if (value === "current-area") return;
                setGlobalFilter(
                  value === "home-lga"
                    ? userProfileLocation
                    : value
                      ? { state: value }
                      : null,
                );
              }}
              className="min-h-11 w-full min-w-0 bg-[#14231B] text-xs text-[#C7D5CB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#82DB7E]"
            >
              <option value="">All Nigeria</option>
              {userProfileLocation?.lga && (
                <option value="home-lga">
                  {userProfileLocation.lga}, {userProfileLocation.state}
                </option>
              )}
              {activeFilter?.lga && (
                <option value="current-area">{displayLabel}</option>
              )}
              {states.filter(Boolean).map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={control}
            aria-label={locating ? "Finding your location" : "Locate me"}
            aria-busy={locating}
            disabled={locating}
            onClick={() => requestLocation()}
          >
            <Locate size={20} className={locating ? "animate-pulse" : ""} />
          </button>
        </div>
        <div className="pointer-events-auto flex max-w-xl gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl border border-white/15 bg-[#14231B] px-3 text-white shadow-lg focus-within:ring-2 focus-within:ring-[#82DB7E]">
            <Search size={18} aria-hidden="true" />
            <input
              aria-label="Search map results"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search this area"
              className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#C7D5CB]"
            />
            {search && (
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center"
                aria-label="Clear search"
                onClick={() => setSearch("")}
              >
                <X size={18} />
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={() => setShowsTraffic((value) => !value)}
            aria-pressed={showsTraffic}
            aria-label="Show traffic"
            className={cn(
              control,
              "gap-1.5 px-3 text-xs",
              showsTraffic && "!bg-[#82DB7E] !text-[#0B0D0B]",
            )}
          >
            <Car size={18} />
            <span className="hidden sm:inline">Traffic</span>
          </button>
        </div>
        <div
          className="pointer-events-auto flex max-w-full gap-2 overflow-x-auto sm:max-w-xl"
          aria-label="Map categories"
        >
          {FILTERS.map((option) => (
            <button
              type="button"
              key={option.key}
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
              className={cn(
                "min-h-11 shrink-0 rounded-full border px-4 text-xs font-semibold shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#82DB7E]",
                filter === option.key
                  ? "border-[#82DB7E] bg-[#82DB7E] text-[#0B0D0B]"
                  : "border-white/15 bg-[#14231B] text-white",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {resultAnnouncement}
      </p>
      <section
        onKeyDown={(event) => {
          if (event.key === "Escape" && selectedPin) {
            event.stopPropagation();
            closePreview();
          }
        }}
        aria-label={selectedPin ? "Selected place" : "Map results"}
        className="absolute inset-x-3 bottom-3 z-20 flex max-h-[calc(100dvh-240px)] flex-col overflow-hidden rounded-3xl border border-white/15 bg-[#14231B] text-white shadow-2xl sm:left-auto sm:right-5 sm:w-[370px] sm:max-h-[65dvh]"
      >
        <div
          className="overflow-y-auto p-4"
          style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }}
        >
          {(locationError || apiFailed) && (
            <div
              role="status"
              className="mb-3 rounded-xl bg-white/10 p-3 text-xs leading-relaxed"
            >
              {apiFailed
                ? "The map is unavailable. You can still browse the results below."
                : locationError}
              {!apiFailed && (
                <button
                  type="button"
                  onClick={() => requestLocation()}
                  className="ml-2 min-h-11 font-bold text-[#82DB7E]"
                >
                  Retry location
                </button>
              )}
            </div>
          )}
          {!!failedSources.length && (
            <div
              role="status"
              className="mb-3 rounded-xl bg-white/10 p-3 text-xs"
            >
              Couldn&apos;t load {failedSources.join(", ")}. Other results are shown.
              <button
                type="button"
                onClick={() => setRetry((value) => value + 1)}
                className="ml-2 min-h-11 font-bold text-[#82DB7E]"
              >
                Retry results
              </button>
            </div>
          )}
          {selectedPin ? (
            <>
              <div className="flex items-start gap-3">
                <PlacePhoto marker={selectedPin} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[#82DB7E]">
                    {MARKER_LABELS[selectedPin.type]}
                  </p>
                  <h2
                    ref={previewRef}
                    tabIndex={-1}
                    className="mt-1 outline-none line-clamp-2 font-yrdly-display text-lg font-bold"
                  >
                    {selectedPin.title}
                  </h2>
                  <p className="mt-1 text-sm text-[#C7D5CB]">
                    {selectedPin.subtitle}
                  </p>
                  {selectedPin.type === "marketplace" && (
                    <p className="mt-1 text-xs text-[#C7D5CB]">
                      Approximate location
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10"
                  aria-label="Close place preview"
                  onClick={closePreview}
                >
                  <X size={20} />
                </button>
              </div>
              {selectedPin.type !== "friend" && (
                <p role="status" className="mt-3 text-xs text-[#C7D5CB]">
                  {etaStatus === "loading"
                    ? "Calculating drive time…"
                    : etaStatus === "error"
                      ? "Drive time unavailable"
                      : eta
                        ? `${Math.ceil((eta.duration_in_traffic_seconds || eta.duration_seconds || 0) / 60)} min drive · ${(eta.distance_meters / 1000).toFixed(1)} km`
                        : ""}
                </p>
              )}
              <Link
                href={markerRoute(selectedPin)}
                className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-[#82DB7E] px-4 py-3 text-sm font-bold text-[#0B0D0B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                View{" "}
                {selectedPin.type === "friend"
                  ? "profile"
                  : MARKER_LABELS[selectedPin.type].toLowerCase()}
              </Link>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-yrdly-display text-lg font-bold">
                    {loading
                      ? "Loading results…"
                      : `${visibleMarkers.length} results`}
                  </h2>
                  <p className="text-xs text-[#C7D5CB]">
                    {FILTERS.find((option) => option.key === filter)?.label} ·
                    selected area
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setResultsOpen((value) => !value)}
                  ref={resultToggleRef}
                  aria-expanded={resultsOpen}
                  aria-controls="map-result-list"
                  className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-bold text-[#82DB7E]"
                >
                  {resultsOpen ? "Hide results" : "Show results"}
                  {resultsOpen ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronUp size={16} />
                  )}
                </button>
              </div>
              {resultsOpen && (
                <div id="map-result-list" className="mt-3 space-y-2">
                  {!loading && !visibleMarkers.length && (
                    <div className="py-4 text-center">
                      <MapPin className="mx-auto mb-2 text-[#82DB7E]" />
                      <p>No matching results</p>
                      <p className="mt-1 text-xs text-[#C7D5CB]">
                        Try another category or search in this area.
                      </p>
                      <button
                        type="button"
                        className="mt-2 min-h-11 text-sm font-bold text-[#82DB7E]"
                        onClick={() => {
                          setSearch("");
                          setFilter("all");
                        }}
                      >
                        Clear filters and search
                      </button>
                    </div>
                  )}
                  {visibleMarkers.map((marker) => (
                    <button
                      type="button"
                      key={marker.id}
                      id={`result-${marker.id}`}
                      onClick={() => selectMarker(marker)}
                      className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#82DB7E]"
                    >
                      <MarkerToken marker={marker} />
                      <span className="min-w-0 flex-1">
                        <span
                          className="block text-[10px] font-bold uppercase tracking-wide"
                          style={{ color: MARKER_COLORS[marker.type] }}
                        >
                          {MARKER_LABELS[marker.type]}
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-sm font-semibold">
                          {marker.title}
                        </span>
                        <span className="mt-1 block truncate text-xs text-[#C7D5CB]">
                          {marker.subtitle}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
