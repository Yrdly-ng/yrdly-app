"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-supabase-auth";


export interface LocationFilter {
  state?: string;
  lga?: string;
  ward?: string;
}

interface LocationContextType {
  /** The user's home location from their profile */
  userProfileLocation: LocationFilter | null;
  /** The active global filter applied across the app */
  activeFilter: LocationFilter | null;
  /** Set the active global filter */
  setGlobalFilter: (filter: LocationFilter | null) => void;
  /** Whether the user has a location set on their profile */
  hasLocation: boolean;
  /** Display label for the current filter */
  displayLabel: string;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

const GLOBAL_FILTER_STORAGE_KEY = "yrdly_global_filter";
const EXPIRATION_TIME_MS = 24 * 60 * 60 * 1000; // 24 hours

interface PersistedFilter {
  filter: LocationFilter | null;
  timestamp: number;
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { profile, user, loading } = useAuth();

  const userState = profile?.home_state || undefined;
  const userLga   = profile?.home_lga   || undefined;
  const userWard  = profile?.home_ward  || undefined;
  const hasLocation = !!userState;

  const userProfileLocation: LocationFilter | null = hasLocation 
    ? { state: userState, lga: userLga, ward: userWard } 
    : null;

  const [activeFilter, setActiveFilterRaw] = useState<LocationFilter | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const initializedUser = useRef<string | null>(null);
  const explicitUser = useRef<string | null>(null);
  const storageKey = `${GLOBAL_FILTER_STORAGE_KEY}:${user?.id || 'guest'}`;

  useEffect(() => {
    if (loading) return;
    const identity = user?.id || 'guest';
    if (initializedUser.current === identity) return;
    if (user && (!profile || profile.id !== user.id)) return;
    let restored: LocationFilter | null = hasLocation ? { state:userState,lga:userLga } : null;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as PersistedFilter;
        if (Number.isFinite(parsed.timestamp) && Date.now() - parsed.timestamp >= 0 &&
            Date.now() - parsed.timestamp < EXPIRATION_TIME_MS && Object.prototype.hasOwnProperty.call(parsed,'filter')) {
          restored = parsed.filter;
        } else localStorage.removeItem(storageKey);
      }
    } catch {}
    if (explicitUser.current !== identity) setActiveFilterRaw(restored);
    initializedUser.current = identity;
    setIsInitialized(true);
  }, [loading,user,profile,storageKey,hasLocation,userState,userLga]);

  const setGlobalFilter = useCallback((newFilter: LocationFilter | null) => {
    explicitUser.current = user?.id || 'guest';
    setActiveFilterRaw(newFilter);
    try {
      const payload: PersistedFilter = { filter:newFilter,timestamp:Date.now() };
      localStorage.setItem(storageKey,JSON.stringify(payload));
    } catch {}
  }, [storageKey,user?.id]);

  // Build the display label
  let displayLabel = "All Nigeria";
  if (activeFilter) {
    if (activeFilter.ward && activeFilter.lga) {
      displayLabel = `${activeFilter.ward}, ${activeFilter.lga}`;
    } else if (activeFilter.lga && activeFilter.state) {
      displayLabel = `${activeFilter.lga}, ${activeFilter.state}`;
    } else if (activeFilter.state) {
      displayLabel = `${activeFilter.state} State`;
    }
  } else if (!isInitialized && hasLocation) {
    // Optimistic label while initializing
    displayLabel = userLga ? `${userLga}, ${userState}` : `${userState} State`;
  }

  return (
    <LocationContext.Provider
      value={{
        userProfileLocation,
        activeFilter,
        setGlobalFilter,
        hasLocation,
        displayLabel,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const context = useContext(LocationContext);
  if (context === undefined) {
    throw new Error("useLocation must be used within a LocationProvider");
  }
  return context;
}
