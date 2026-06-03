"use client";

import { useState, useRef, useEffect } from "react";
import { MapPin, ChevronDown, Globe, Navigation, Map, X } from "lucide-react";
import { useLocation } from "@/contexts/LocationContext";
import { useRouter } from "next/navigation";
import states from "@/data/states.json";

const GREEN = "hsl(var(--primary))";
const FONT = "var(--font-work-sans)";
const CARD = "var(--c-card)";
const BG = "var(--c-bg)";

/**
 * Location filter chip with dropdown menu.
 * Supports: My LGA, My State, Other State (picker), All Nigeria.
 */
export function LocationChip() {
  const {
    displayLabel,
    userProfileLocation,
    activeFilter,
    setGlobalFilter,
    hasLocation,
  } = useLocation();
  const router = useRouter();

  const userState = userProfileLocation?.state || "";
  const userLga = userProfileLocation?.lga || "";
  const browseState = activeFilter?.state && activeFilter.state !== userState ? activeFilter.state : "";

  let scope: "lga" | "state" | "other_state" | "all" = "all";
  if (!activeFilter) {
    scope = "all";
  } else if (activeFilter.state !== userState) {
    scope = "other_state";
  } else if (activeFilter.lga === userLga) {
    scope = "lga";
  } else {
    scope = "state";
  }

  const [open, setOpen] = useState(false);
  const [showStatePicker, setShowStatePicker] = useState(false);
  const [stateSearch, setStateSearch] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowStatePicker(false);
        setStateSearch("");
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus search input when state picker opens
  useEffect(() => {
    if (showStatePicker && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showStatePicker]);

  if (!hasLocation) {
    return (
      <button
        onClick={() => router.push("/onboarding/profile")}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.6875rem] font-semibold transition-all active:scale-95"
        style={{
          background: "rgba(56,142,60,0.15)",
          color: GREEN,
          border: `0.5px solid ${GREEN}`,
          fontFamily: FONT,
        }}
      >
        <MapPin className="w-3.5 h-3.5" />
        Set Location
      </button>
    );
  }

  const allStates: string[] = states
    .filter((s): s is string => !!s)
    .sort();

  const filteredStates = stateSearch
    ? allStates.filter((s) =>
        s.toLowerCase().includes(stateSearch.toLowerCase())
      )
    : allStates;

  const handleSelectScope = (newScope: "lga" | "state" | "all") => {
    if (newScope === "lga") {
      setGlobalFilter({ state: userState, lga: userLga });
    } else if (newScope === "state") {
      setGlobalFilter({ state: userState });
    } else {
      setGlobalFilter(null); // all
    }
    setOpen(false);
    setShowStatePicker(false);
    setStateSearch("");
  };

  const handleSelectOtherState = (state: string) => {
    setGlobalFilter({ state });
    setOpen(false);
    setShowStatePicker(false);
    setStateSearch("");
  };

  const chipColor =
    scope === "lga"
      ? GREEN
      : scope === "state"
      ? "#2E7D32"
      : scope === "other_state"
      ? "#E65100"
      : "#1565C0";

  return (
    <div className="relative" ref={menuRef}>
      {/* Chip button */}
      <button
        onClick={() => {
          setOpen(!open);
          setShowStatePicker(false);
          setStateSearch("");
        }}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.6875rem] font-semibold transition-all active:scale-95"
        style={{
          background: `${chipColor}18`,
          color: chipColor,
          border: `0.5px solid ${chipColor}66`,
          fontFamily: FONT,
        }}
      >
        {scope === "all" ? (
          <Globe className="w-3.5 h-3.5" />
        ) : scope === "other_state" ? (
          <Map className="w-3.5 h-3.5" />
        ) : (
          <MapPin className="w-3.5 h-3.5" />
        )}
        <span className="max-w-[160px] truncate">{displayLabel}</span>
        <ChevronDown
          className="w-3 h-3 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          className="absolute left-0 top-full mt-2 rounded-xl shadow-2xl overflow-hidden z-50"
          style={{
            background: 'var(--c-card)',
            border: "1px solid var(--c-border)",
            minWidth: 220,
            animation: "fadeInScale 0.15s ease-out",
          }}
        >
          {!showStatePicker ? (
            /* ── Main menu ── */
            <div className="py-1.5">
              {/* My LGA */}
              <button
                onClick={() => handleSelectScope("lga")}
                className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
                style={{
                  background: scope === "lga" ? "rgba(56,142,60,0.12)" : "transparent",
                }}
                onMouseEnter={(e) =>
                  scope !== "lga" &&
                  ((e.currentTarget.style.background) = "rgba(128,128,128,0.08)")
                }
                onMouseLeave={(e) =>
                  scope !== "lga" &&
                  ((e.currentTarget.style.background) = "transparent")
                }
              >
                <Navigation
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: scope === "lga" ? GREEN : "var(--c-text-muted)" }}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[0.75rem] font-semibold truncate"
                    style={{ color: scope === "lga" ? GREEN : "var(--c-text)", fontFamily: FONT }}
                  >
                    {userLga || "My LGA"}
                  </p>
                  <p className="text-[0.625rem]" style={{ color: "var(--c-text-muted)" }}>
                    Neighborhood
                  </p>
                </div>
                {scope === "lga" && (
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: GREEN }}
                  />
                )}
              </button>

              {/* My State */}
              <button
                onClick={() => handleSelectScope("state")}
                className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
                style={{
                  background: scope === "state" ? "rgba(46,125,50,0.1)" : "transparent",
                }}
                onMouseEnter={(e) =>
                  scope !== "state" &&
                  ((e.currentTarget.style.background) = "rgba(128,128,128,0.08)")
                }
                onMouseLeave={(e) =>
                  scope !== "state" &&
                  ((e.currentTarget.style.background) = "transparent")
                }
              >
                <MapPin
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: scope === "state" ? "#2E7D32" : "var(--c-text-muted)" }}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[0.75rem] font-semibold truncate"
                    style={{ color: scope === "state" ? "#2E7D32" : "var(--c-text)", fontFamily: FONT }}
                  >
                    {userState} State
                  </p>
                  <p className="text-[0.625rem]" style={{ color: "var(--c-text-muted)" }}>
                    Entire state
                  </p>
                </div>
                {scope === "state" && (
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: "#2E7D32" }}
                  />
                )}
              </button>

              {/* Divider */}
              <div className="mx-4 my-1" style={{ borderTop: "1px solid var(--c-border)" }} />

              {/* Other State */}
              <button
                onClick={() => setShowStatePicker(true)}
                className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
                style={{
                  background: scope === "other_state" ? "rgba(230,81,0,0.1)" : "transparent",
                }}
                onMouseEnter={(e) =>
                  scope !== "other_state" &&
                  ((e.currentTarget.style.background) = "rgba(128,128,128,0.08)")
                }
                onMouseLeave={(e) =>
                  scope !== "other_state" &&
                  ((e.currentTarget.style.background) = "transparent")
                }
              >
                <Map
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: scope === "other_state" ? "#E65100" : "var(--c-text-muted)" }}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[0.75rem] font-semibold truncate"
                    style={{ color: scope === "other_state" ? "#E65100" : "var(--c-text)", fontFamily: FONT }}
                  >
                    {scope === "other_state" && browseState
                      ? `${browseState} State`
                      : "Browse Other State"}
                  </p>
                  <p className="text-[0.625rem]" style={{ color: "var(--c-text-muted)" }}>
                    Explore another area
                  </p>
                </div>
                <ChevronDown
                  className="w-3 h-3 flex-shrink-0"
                  style={{ color: "#666", transform: "rotate(-90deg)" }}
                />
              </button>

              {/* All Nigeria */}
              <button
                onClick={() => handleSelectScope("all")}
                className="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left"
                style={{
                  background: scope === "all" ? "rgba(21,101,192,0.1)" : "transparent",
                }}
                onMouseEnter={(e) =>
                  scope !== "all" &&
                  ((e.currentTarget.style.background) = "rgba(128,128,128,0.08)")
                }
                onMouseLeave={(e) =>
                  scope !== "all" &&
                  ((e.currentTarget.style.background) = "transparent")
                }
              >
                <Globe
                  className="w-4 h-4 flex-shrink-0"
                  style={{ color: scope === "all" ? "#1565C0" : "var(--c-text-muted)" }}
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[0.75rem] font-semibold"
                    style={{ color: scope === "all" ? "#1565C0" : "var(--c-text)", fontFamily: FONT }}
                  >
                    All Nigeria
                  </p>
                  <p className="text-[0.625rem]" style={{ color: "var(--c-text-muted)" }}>
                    Everything, everywhere
                  </p>
                </div>
                {scope === "all" && (
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: "#1565C0" }}
                  />
                )}
              </button>
            </div>
          ) : (
            /* ── State picker ── */
            <div>
              {/* Search header */}
              <div
                className="flex items-center gap-2 px-3 py-2"
                style={{ borderBottom: "1px solid var(--c-border)" }}
              >
                <button
                  onClick={() => {
                    setShowStatePicker(false);
                    setStateSearch("");
                  }}
                  className="p-1"
                >
                  <X className="w-4 h-4" style={{ color: "var(--c-text-muted)" }} />
                </button>
                <input
                  ref={inputRef}
                  type="text"
                  value={stateSearch}
                  onChange={(e) => setStateSearch(e.target.value)}
                  placeholder="Search states..."
                  className="flex-1 bg-transparent text-foreground text-[0.75rem] outline-none placeholder-gray-500"
                  style={{ fontFamily: FONT }}
                />
              </div>

              {/* State list */}
              <div className="max-h-[240px] overflow-y-auto py-1">
                {filteredStates.map((state) => (
                  <button
                    key={state}
                    onClick={() => handleSelectOtherState(state)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left"
                    style={{
                      background:
                        browseState === state && scope === "other_state"
                          ? "rgba(230,81,0,0.1)"
                          : "transparent",
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget.style.background) = "rgba(128,128,128,0.08)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget.style.background) =
                        browseState === state && scope === "other_state"
                          ? "rgba(230,81,0,0.1)"
                          : "transparent")
                    }
                  >
                    <span
                      className="text-[0.75rem]"
                      style={{
                        fontFamily: FONT,
                        color:
                          state === userState
                            ? GREEN
                            : browseState === state
                            ? "#E65100"
                            : "var(--c-text)",
                      }}
                    >
                      {state}
                    </span>
                    {state === userState && (
                      <span className="text-[0.5625rem] ml-auto" style={{ color: "var(--c-text-muted)" }}>
                        Home
                      </span>
                    )}
                  </button>
                ))}
                {filteredStates.length === 0 && (
                  <p
                    className="text-center py-4 text-[0.75rem]"
                    style={{ color: "var(--c-text-muted)", fontFamily: FONT }}
                  >
                    No states found
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Animation keyframes */}
      <style jsx>{`
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(-4px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
