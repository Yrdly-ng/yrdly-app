"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
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
  filter: LocationFilter;
  timestamp: number;
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();

  const profileLocation = profile?.location as any;
  const userState = profileLocation?.state || null;
  const userLga = profileLocation?.lga || null;
  const userWard = profileLocation?.ward || null;
  const hasLocation = !!userState;

  const userProfileLocation: LocationFilter | null = hasLocation 
    ? { state: userState, lga: userLga, ward: userWard } 
    : null;

  const [activeFilter, setActiveFilterRaw] = useState<LocationFilter | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Restore persisted filter on mount, or fallback to user profile location
  useEffect(() => {
    try {
      const savedData = localStorage.getItem(GLOBAL_FILTER_STORAGE_KEY);
      if (savedData) {
        const parsed = JSON.parse(savedData);
        
        // Handle migration from old format where the filter itself was saved directly
        // and new format where it is { filter, timestamp }
        if (parsed.timestamp && parsed.filter) {
          const isExpired = Date.now() - parsed.timestamp > EXPIRATION_TIME_MS;
          if (isExpired) {
            localStorage.removeItem(GLOBAL_FILTER_STORAGE_KEY);
            if (hasLocation) setActiveFilterRaw({ state: userState, lga: userLga });
          } else {
            setActiveFilterRaw(parsed.filter);
          }
        } else {
          // Old format detected - clear it to enforce home reset
          localStorage.removeItem(GLOBAL_FILTER_STORAGE_KEY);
          if (hasLocation) setActiveFilterRaw({ state: userState, lga: userLga });
        }
      } else if (hasLocation) {
        // Default to user's LGA if no filter is set
        setActiveFilterRaw({ state: userState, lga: userLga });
      }
    } catch {
      if (hasLocation) {
        setActiveFilterRaw({ state: userState, lga: userLga });
      }
    }
    setIsInitialized(true);
  }, [hasLocation, userState, userLga]);

  const setGlobalFilter = useCallback((newFilter: LocationFilter | null) => {
    setActiveFilterRaw(newFilter);
    try {
      if (newFilter) {
        const payload: PersistedFilter = { filter: newFilter, timestamp: Date.now() };
        localStorage.setItem(GLOBAL_FILTER_STORAGE_KEY, JSON.stringify(payload));
      } else {
        localStorage.removeItem(GLOBAL_FILTER_STORAGE_KEY);
      }
    } catch {
      // localStorage not available
    }
  }, []);

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
