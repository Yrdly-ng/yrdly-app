"use client";

import { useGpsLocation } from "@/hooks/use-gps-location";
import { MapPin, Navigation, Map, AlertCircle, Loader2, CheckCircle2 } from "lucide-react";
import { OUTSIDE_NIGERIA } from "@/lib/geocoding-service";

interface GpsLocationStepProps {
  onLocationFound: (location: { state: string; lga: string; ward: string; lat?: number; lng?: number }) => void;
  onFallbackToManual: (reason?: string) => void;
}

export function GpsLocationStep({ onLocationFound, onFallbackToManual }: GpsLocationStepProps) {
  const { status, location, error, detectLocation, reset } = useGpsLocation();

  if (status === "success" && location) {
    return (
      <div className="w-full rounded-[24px] bg-background/60 border border-[#388E3C]/50 p-6 space-y-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 shrink-0 rounded-2xl bg-[#388E3C]/10 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-[#388E3C]" />
          </div>
          <div>
            <h4 className="text-white font-bold text-lg mb-1">Location Detected</h4>
            <p className="text-muted-foreground text-sm font-medium">
              {location.lga}, {location.state} State
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onLocationFound({ state: location.state, lga: location.lga, ward: location.ward, lat: location.lat, lng: location.lng })}
            className="flex-1 h-12 bg-[#388E3C] hover:bg-[#2E7D32] text-white rounded-xl font-bold transition-colors"
          >
            Confirm Location
          </button>
          <button
            type="button"
            onClick={() => {
              reset();
              onFallbackToManual();
            }}
            className="px-6 h-12 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors border border-border"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  if (status === "requesting" || status === "geocoding") {
    return (
      <div className="w-full rounded-[24px] bg-background/60 border border-border p-8 flex flex-col items-center justify-center space-y-4 text-center">
        <Loader2 className="w-8 h-8 text-[#388E3C] animate-spin" />
        <div>
          <h4 className="text-white font-bold text-lg">Detecting Location</h4>
          <p className="text-muted-foreground text-sm font-medium">
            {status === "requesting" ? "Asking for permission..." : "Finding your neighborhood..."}
          </p>
        </div>
      </div>
    );
  }

  if (status === OUTSIDE_NIGERIA) {
    return (
      <div className="w-full space-y-4 animate-in fade-in zoom-in-95 duration-300">
        <div className="w-full rounded-[24px] bg-[#388E3C]/10 border border-[#388E3C]/30 p-6 flex flex-col items-center justify-center space-y-3 text-center">
          <Map className="w-8 h-8 text-[#388E3C]" />
          <p className="text-[#388E3C] font-bold text-sm">
            It looks like you're currently outside Nigeria. Please select your home community below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onFallbackToManual(OUTSIDE_NIGERIA)}
          className="w-full py-4 rounded-xl text-white font-bold bg-[#388E3C] hover:bg-[#2E7D32] transition-colors shadow-lg"
        >
          Select State & LGA Manually
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4">
      <button
        type="button"
        onClick={detectLocation}
        className="w-full relative group overflow-hidden rounded-[24px] bg-gradient-to-r from-[#388E3C]/20 to-[#388E3C]/10 border border-[#388E3C]/30 p-6 flex items-center justify-between transition-all hover:border-[#388E3C]/60 active:scale-[0.98]"
      >
        <div className="absolute inset-0 bg-[#388E3C]/10 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-500 ease-out" />
        <div className="relative z-10 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#388E3C]/20 flex items-center justify-center">
            <Navigation className="w-5 h-5 text-[#388E3C]" />
          </div>
          <div className="text-left">
            <h4 className="text-white font-black text-lg">Auto-Detect Location</h4>
            <p className="text-[#388E3C] text-xs font-bold uppercase tracking-wider">Use Device GPS</p>
          </div>
        </div>
        <div className="relative z-10 w-8 h-8 rounded-full bg-[#388E3C]/20 flex items-center justify-center group-hover:bg-[#388E3C] transition-colors">
          <MapPin className="w-4 h-4 text-[#388E3C] group-hover:text-white transition-colors" />
        </div>
      </button>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-bold">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <div className="flex items-center gap-4 py-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">OR</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <button
        type="button"
        onClick={() => onFallbackToManual()}
        className="w-full py-4 rounded-xl text-muted-foreground font-bold hover:text-white hover:bg-white/5 transition-colors border border-transparent hover:border-border"
      >
        Select State & LGA Manually
      </button>
    </div>
  );
}
