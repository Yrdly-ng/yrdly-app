"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/use-supabase-auth";

type LocationScope = "lga" | "state" | "other_state" | "all";

interface LocationContextType {
  /** The user's home state from their profile */
  userState: string | null;
  /** The user's home LGA from their profile */
  userLga: string | null;
  /** The user's home ward from their profile */
  userWard: string | null;
  /** Current filter scope */
  scope: LocationScope;
  /** Set the scope */
  setScope: (scope: LocationScope) => void;
  /** Whether the user has a location set at all */
  hasLocation: boolean;
  /** Display label for the current filter */
  displayLabel: string;
  /** The state value to filter by */
  filterState: string | null;
  /** The LGA value to filter by (only when scope is 'lga') */
  filterLga: string | null;
  /** When scope is 'other_state', the selected state name */
  browseState: string | null;
  /** Set a different state to browse */
  setBrowseState: (state: string) => void;
}

const LocationContext = createContext<LocationContextType | undefined>(undefined);

const SCOPE_STORAGE_KEY = "yrdly_location_scope";
const BROWSE_STATE_KEY = "yrdly_browse_state";

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();

  const userState = (profile?.location as any)?.state || null;
  const userLga = (profile?.location as any)?.lga || null;
  const userWard = (profile?.location as any)?.ward || null;
  const hasLocation = !!userState;

  const [scope, setScopeRaw] = useState<LocationScope>("lga");
  const [browseState, setBrowseStateRaw] = useState<string | null>(null);

  // Restore persisted preferences on mount
  useEffect(() => {
    try {
      const savedScope = localStorage.getItem(SCOPE_STORAGE_KEY);
      if (savedScope === "lga" || savedScope === "state" || savedScope === "other_state" || savedScope === "all") {
        setScopeRaw(savedScope);
      }
      const savedBrowse = localStorage.getItem(BROWSE_STATE_KEY);
      if (savedBrowse) {
        setBrowseStateRaw(savedBrowse);
      }
    } catch {
      // localStorage not available
    }
  }, []);

  const setScope = useCallback((newScope: LocationScope) => {
    setScopeRaw(newScope);
    try {
      localStorage.setItem(SCOPE_STORAGE_KEY, newScope);
    } catch {
      // localStorage not available
    }
  }, []);

  const setBrowseState = useCallback((state: string) => {
    setBrowseStateRaw(state);
    setScopeRaw("other_state");
    try {
      localStorage.setItem(BROWSE_STATE_KEY, state);
      localStorage.setItem(SCOPE_STORAGE_KEY, "other_state");
    } catch {
      // localStorage not available
    }
  }, []);

  // Build the display label
  let displayLabel = "Set Location";
  if (hasLocation || scope === "all") {
    switch (scope) {
      case "lga":
        displayLabel = userLga ? `${userLga}, ${userState}` : `${userState} State`;
        break;
      case "state":
        displayLabel = `${userState} State`;
        break;
      case "other_state":
        displayLabel = browseState ? `${browseState} State` : "Select State";
        break;
      case "all":
        displayLabel = "All Nigeria";
        break;
    }
  }

  // Build the active filters
  let filterState: string | null = null;
  let filterLga: string | null = null;

  if (!hasLocation) {
    filterState = null;
    filterLga = null;
  } else {
    switch (scope) {
      case "lga":
        filterState = userState;
        filterLga = userLga;
        break;
      case "state":
        filterState = userState;
        filterLga = null;
        break;
      case "other_state":
        filterState = browseState;
        filterLga = null;
        break;
      case "all":
        filterState = null;
        filterLga = null;
        break;
    }
  }

  return (
    <LocationContext.Provider
      value={{
        userState,
        userLga,
        userWard,
        scope,
        setScope,
        hasLocation,
        displayLabel,
        filterState,
        filterLga,
        browseState,
        setBrowseState,
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
