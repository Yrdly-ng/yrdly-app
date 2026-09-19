"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useLocationData } from "@/hooks/use-location-data";
import { ChevronLeft, MapPin, Navigation, Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { resolveCoords, OUTSIDE_NIGERIA } from "@/lib/geocoding-service";
import { useToast } from "@/hooks/use-toast";

export default function LocationSettingsPage() {
  const router = useRouter();
  const { profile, updateProfile } = useAuth();
  const { toast } = useToast();
  const {
    states,
    lgas,
    wards,
    isLoading: locationLoading,
    loadLgas,
    loadWards,
  } = useLocationData();

  const [updating, setUpdating] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);

  const currentLga = profile?.home_lga || (profile?.location as any)?.lga;
  const currentState = profile?.home_state || (profile?.location as any)?.state;
  const currentNeighbourhood =
    currentLga && currentState ? `${currentLga}, ${currentState}` : currentState || "Not set";

  const [selectedState, setSelectedState] = useState(
    profile?.home_state || (profile?.location as any)?.state || ""
  );
  const [selectedLga, setSelectedLga] = useState(
    profile?.home_lga || (profile?.location as any)?.lga || ""
  );
  const [selectedWard, setSelectedWard] = useState(
    profile?.home_ward || (profile?.location as any)?.ward || ""
  );
  const [saved, setSaved] = useState(false);
  const [showMigrationPrompt, setShowMigrationPrompt] = useState(false);
  const [activeListingsCount, setActiveListingsCount] = useState(0);
  const [outsideNigeriaMsg, setOutsideNigeriaMsg] = useState(false);

  // Load LGAs on state change or mount
  useEffect(() => {
    if (selectedState) loadLgas(selectedState);
  }, [selectedState, loadLgas]);

  // Load Wards on LGA change or mount
  useEffect(() => {
    if (selectedState && selectedLga) loadWards(selectedState, selectedLga);
  }, [selectedState, selectedLga, loadWards]);

  const handleSaveLocation = async (
    state: string,
    lga: string,
    ward: string | null,
    lat?: number,
    lng?: number,
    migrateListings = false
  ) => {
    setUpdating(true);
    try {
      const updateData: any = {
        home_state: state,
        home_lga: lga,
        home_ward: ward || null,
        location: { state, lga, ward: ward || undefined },
      };

      if (lat !== undefined && lng !== undefined) {
        updateData.home_lat = lat;
        updateData.home_lng = lng;
        updateData.home_location_geom = `POINT(${lng} ${lat})`;
      }

      await updateProfile(updateData);

      if (migrateListings && profile?.id) {
        await supabase
          .from("posts")
          .update({
            state,
            lga,
            ward: ward || null,
          })
          .eq("user_id", profile.id)
          .eq("category", "For Sale")
          .eq("is_sold", false);
      }

      setSaved(true);
      setShowMigrationPrompt(false);
      toast({ title: "Success", description: "Location updated successfully." });
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Failed to update location.", variant: "destructive" });
    } finally {
      setUpdating(false);
    }
  };

  const handleUseGPS = async () => {
    if (!navigator.geolocation) {
      toast({ title: "Error", description: "Geolocation is not supported by your browser.", variant: "destructive" });
      return;
    }

    setGpsLoading(true);
    setOutsideNigeriaMsg(false);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const match = await resolveCoords(lat, lng);

          if (match === OUTSIDE_NIGERIA) {
            setOutsideNigeriaMsg(true);
            toast({ title: "Outside Nigeria", description: "GPS placed you outside Nigeria. Please select your home area manually." });
          } else if (match) {
            setSelectedState(match.state);
            setSelectedLga(match.lga);
            setSelectedWard(match.ward || "");
            await handleSaveLocation(match.state, match.lga, match.ward || null, lat, lng);
          } else {
            toast({ title: "Error", description: "Could not resolve location structure.", variant: "destructive" });
          }
        } catch (e: any) {
          toast({ title: "Error", description: e.message || "Failed to resolve GPS coordinates.", variant: "destructive" });
        } finally {
          setGpsLoading(false);
        }
      },
      (err) => {
        setGpsLoading(false);
        toast({ title: "Permission Denied", description: "Could not access location services.", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const hasChanges =
    selectedState !== (profile?.home_state || (profile?.location as any)?.state || "") ||
    selectedLga !== (profile?.home_lga || (profile?.location as any)?.lga || "") ||
    selectedWard !== (profile?.home_ward || (profile?.location as any)?.ward || "");

  const canSave = selectedState && selectedLga && hasChanges;

  const handleSaveClick = async () => {
    if (!canSave) return;
    setUpdating(true);

    try {
      const { count, error } = await supabase
        .from("posts")
        .select("*", { count: "exact", head: true })
        .eq("user_id", profile?.id || "")
        .eq("category", "For Sale")
        .eq("is_sold", false);

      if (!error && count && count > 0) {
        setActiveListingsCount(count);
        setShowMigrationPrompt(true);
        setUpdating(false);
        return;
      }
    } catch (e) {
      console.error(e);
    }

    await handleSaveLocation(selectedState, selectedLga, selectedWard || null, undefined, undefined, false);
  };

  return (
    <div className="min-h-screen bg-[var(--yrdly-dark)] text-[var(--yrdly-text)] pb-20 font-yrdly-body">
      {/* Header */}
      <header className="lg:hidden sticky top-0 z-30 bg-[var(--yrdly-dark)]/80 backdrop-blur-md px-5 py-3 border-b border-[var(--yrdly-glass-border)]">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded-[11px] bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] flex items-center justify-center text-[var(--yrdly-text)] hover:opacity-80 transition-opacity lg:hidden"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="text-[18px] font-bold text-[var(--yrdly-text)] font-yrdly-display">
            Location Settings
          </h1>
          <div className="w-8 h-8 flex items-center justify-center">
            {updating && (
              <div className="w-4 h-4 border-2 border-[#82DB7E] border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-5 py-5 space-y-5">
        {/* Current Location Card */}
        <div className="flex items-center gap-3 p-4 bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] rounded-[16px]">
          <div className="w-9 h-9 rounded-full bg-[rgba(130,219,126,0.1)] flex items-center justify-center flex-shrink-0">
            <MapPin className="w-[18px] h-[18px] text-[#82DB7E]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--yrdly-muted)] mb-1 font-yrdly-body">
              CURRENT NEIGHBOURHOOD
            </p>
            <p className="text-[15px] font-semibold text-[var(--yrdly-text)] truncate font-yrdly-body">
              {currentNeighbourhood}
            </p>
          </div>
        </div>

        {/* GPS Button */}
        <button
          onClick={handleUseGPS}
          disabled={gpsLoading || updating}
          className="w-full h-[50px] rounded-[25px] bg-[#82DB7E] text-black font-semibold text-[14px] font-yrdly-body hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
        >
          {gpsLoading ? (
            <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <Navigation className="w-4 h-4 text-black" />
              <span>Use Current Location (GPS)</span>
            </>
          )}
        </button>

        {/* Outside Nigeria warning */}
        {outsideNigeriaMsg && (
          <div className="p-4 rounded-[16px] bg-[rgba(130,219,126,0.1)] border border-[rgba(130,219,126,0.3)] text-[13px] font-medium text-[#82DB7E]">
            It looks like you&apos;re currently outside Nigeria. Please select your home community below.
          </div>
        )}

        {/* Section label */}
        <div className="pt-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-[var(--yrdly-muted)] mb-3 font-yrdly-body">
            CHANGE NEIGHBOURHOOD
          </p>

          <div className="space-y-4 font-yrdly-body">
            {/* State Selector */}
            <div className="space-y-1.5">
              <label className="text-[12px] uppercase tracking-[0.8px] text-[var(--yrdly-label)] font-yrdly-body">
                State *
              </label>
              <select
                value={selectedState}
                onChange={(e) => {
                  setSelectedState(e.target.value);
                  setSelectedLga("");
                  setSelectedWard("");
                  setSaved(false);
                }}
                disabled={locationLoading}
                className="w-full h-12 px-4 rounded-[14px] bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] text-[14px] text-[var(--yrdly-text)] outline-none appearance-none font-yrdly-body"
              >
                <option value="" className="bg-[var(--yrdly-dark)]">Select State</option>
                {states.filter(Boolean).map((st) => (
                  <option key={st} value={st} className="bg-[var(--yrdly-dark)]">
                    {st}
                  </option>
                ))}
              </select>
            </div>

            {/* LGA Selector */}
            <div className="space-y-1.5">
              <label className="text-[12px] uppercase tracking-[0.8px] text-[var(--yrdly-label)] font-yrdly-body">
                Local Government Area *
              </label>
              <select
                value={selectedLga}
                onChange={(e) => {
                  setSelectedLga(e.target.value);
                  setSelectedWard("");
                  setSaved(false);
                }}
                disabled={!selectedState || locationLoading}
                className="w-full h-12 px-4 rounded-[14px] bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] text-[14px] text-[var(--yrdly-text)] outline-none appearance-none disabled:opacity-50 font-yrdly-body"
              >
                <option value="" className="bg-[var(--yrdly-dark)]">
                  {!selectedState ? "Select state first" : "Select LGA"}
                </option>
                {lgas.filter(Boolean).map((lg) => (
                  <option key={lg} value={lg} className="bg-[var(--yrdly-dark)]">
                    {lg}
                  </option>
                ))}
              </select>
            </div>

            {/* Ward Selector */}
            <div className="space-y-1.5">
              <label className="text-[12px] uppercase tracking-[0.8px] text-[var(--yrdly-label)] font-yrdly-body">
                Ward (Optional)
              </label>
              <select
                value={selectedWard}
                onChange={(e) => {
                  setSelectedWard(e.target.value);
                  setSaved(false);
                }}
                disabled={!selectedLga || locationLoading}
                className="w-full h-12 px-4 rounded-[14px] bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] text-[14px] text-[var(--yrdly-text)] outline-none appearance-none disabled:opacity-50 font-yrdly-body"
              >
                <option value="" className="bg-[var(--yrdly-dark)]">
                  {!selectedLga ? "Select LGA first" : "Select Ward"}
                </option>
                {wards.filter(Boolean).map((wd) => (
                  <option key={wd} value={wd} className="bg-[var(--yrdly-dark)]">
                    {wd}
                  </option>
                ))}
              </select>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveClick}
              disabled={!canSave || updating}
              className="w-full py-4 rounded-[18px] bg-[#82DB7E] text-black font-bold text-[15px] font-yrdly-display hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center mt-4"
            >
              {updating ? (
                <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
              ) : saved ? (
                <span className="flex items-center gap-2">
                  <Check className="w-5 h-5" />
                  Location Updated!
                </span>
              ) : (
                "Save Location"
              )}
            </button>
          </div>
        </div>

        {/* Migration Prompt Modal */}
        {showMigrationPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-sm p-6 rounded-[24px] space-y-4 bg-[var(--yrdly-dark)] border border-[var(--yrdly-glass-border)] text-[var(--yrdly-text)] font-yrdly-body shadow-2xl">
              <h3 className="text-[18px] font-bold font-yrdly-display">Update Active Listings?</h3>
              <p className="text-[14px] text-[var(--yrdly-label)]">
                You have {activeListingsCount} active marketplace {activeListingsCount === 1 ? "listing" : "listings"}. Would you like to update their location to your new home area so local buyers can find them?
              </p>
              <div className="flex flex-col gap-2 pt-2">
                <button
                  onClick={() => handleSaveLocation(selectedState, selectedLga, selectedWard || null, undefined, undefined, true)}
                  disabled={updating}
                  className="w-full py-3.5 rounded-[16px] font-bold bg-[#82DB7E] text-black hover:opacity-90 transition-all"
                >
                  Yes, Update Listings
                </button>
                <button
                  onClick={() => handleSaveLocation(selectedState, selectedLga, selectedWard || null, undefined, undefined, false)}
                  disabled={updating}
                  className="w-full py-3.5 rounded-[16px] font-semibold bg-[var(--yrdly-surface)] border border-[var(--yrdly-glass-border)] text-[var(--yrdly-text)] hover:opacity-80 transition-all"
                >
                  No, Keep Old Location
                </button>
                <button
                  onClick={() => {
                    setShowMigrationPrompt(false);
                    setUpdating(false);
                  }}
                  disabled={updating}
                  className="w-full py-2 text-[13px] text-[var(--yrdly-label)] hover:text-[var(--yrdly-text)] transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

