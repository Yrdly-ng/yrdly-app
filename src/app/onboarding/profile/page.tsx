"use client";

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { SceneBg, GlassCard, GlassInput, StepBar, PrimaryBtn } from '@/components/onboarding/primitives';
import { AuthService } from '@/lib/auth-service';
import { useAuth } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase';
import { useGpsLocation } from '@/hooks/use-gps-location';
import { Camera, MapPin, Navigation, AlertTriangle, Loader2, Heart, ArrowLeft, ArrowRight } from 'lucide-react';
import POPULAR_INTERESTS from '@/data/interests.json';
import LGAS_DATA_RAW from '@/data/lgas.json';
import STATES_DATA_RAW from '@/data/states.json';
import WARDS_DATA_RAW from '@/data/wards.json';

import { usePlaces } from '@/hooks/use-places-autocomplete';

const LGAS_DATA: Record<string, string[]> = LGAS_DATA_RAW;
const STATES_DATA: string[] = STATES_DATA_RAW.filter(Boolean).sort();
const WARDS_DATA = WARDS_DATA_RAW as Array<{ State: string; LGA: string; Ward: string; Latitude?: number; Longitude?: number }>;

interface ResolvedWard {
  state: string;
  lga: string;
  ward: string;
  label: string;
  place_id?: string;
  lat?: number;
  lng?: number;
  isGooglePlace?: boolean;
}

function OnboardingProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phoneSkipped = searchParams.get('phoneSkipped') === 'true';
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const gps = useGpsLocation();
  const places = usePlaces();

  // Step 1 State: Identity & Location
  const [handle, setHandle] = useState('');
  const [usernameErr, setUsernameErr] = useState('');
  const [locQuery, setLocQuery] = useState('');
  const [locSuggestions, setLocSuggestions] = useState<ResolvedWard[]>([]);
  const [locSearching, setLocSearching] = useState(false);
  const [selectedLoc, setSelectedLoc] = useState<ResolvedWard | null>(null);
  const [locError, setLocError] = useState('');

  // Manual Selectors State
  const [showManualPick, setShowManualPick] = useState(false);
  const [manualState, setManualState] = useState('');
  const [manualLga, setManualLga] = useState('');

  // Step 2 State: Personalization & Interests
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [bio, setBio] = useState('');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const FEATURED_INTERESTS = POPULAR_INTERESTS.slice(0, 24);

  useEffect(() => {
    if (user?.user_metadata?.username) {
      setHandle(user.user_metadata.username);
    }
  }, [user]);

  const handlePickAvatar = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAvatarFile(file);
      setAvatarUri(URL.createObjectURL(file));
    }
  };

  useEffect(() => {
    if (gps.status === 'success' && gps.location) {
      const { state, lga, ward, displayAddress, lat, lng } = gps.location;
      const resolved: ResolvedWard = { state, lga, ward, label: `${ward}, ${lga}, ${state}`, lat, lng };
      setSelectedLoc(resolved);
      setLocQuery(displayAddress || resolved.label);
      setLocError('');
    } else if (gps.status === 'denied' || gps.status === 'error' || gps.status === 'timeout') {
      setLocError(gps.error || 'Could not detect location. Please search or select manually.');
    }
  }, [gps.status, gps.location, gps.error]);

  const handleLocQuery = (v: string) => {
    setLocQuery(v);
    setLocError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim() || v.trim().length < 2) {
      setLocSuggestions([]);
      places.clearSuggestions();
      return;
    }

    if (places.ready) {
      places.getPlacePredictions(v);
    }
    setLocSearching(true);

    debounceRef.current = setTimeout(() => {
      const q = v.trim().toLowerCase();
      const scoredMap = new Map<string, { resolved: ResolvedWard; score: number }>();

      // 1. Search Wards Dataset (8,800+ wards with State, LGA, Ward)
      for (let i = 0; i < WARDS_DATA.length; i++) {
        const item = WARDS_DATA[i];
        const wardLower = (item.Ward || '').toLowerCase();
        const lgaLower = (item.LGA || '').toLowerCase();
        const stateLower = (item.State || '').toLowerCase();

        let score = 0;

        if (wardLower === q) score = 1000;
        else if (lgaLower === q) score = 900;
        else if (wardLower.startsWith(q)) score = 800;
        else if (lgaLower.startsWith(q)) score = 700;
        else if (wardLower.includes(q)) score = 600;
        else if (lgaLower.includes(q)) score = 500;
        else if (stateLower === q || stateLower.startsWith(q)) score = 300;
        else if (stateLower.includes(q)) score = 100;

        if (score > 0) {
          const label = item.Ward ? `${item.Ward}, ${item.LGA}, ${item.State}` : `${item.LGA}, ${item.State} State`;
          const existing = scoredMap.get(label);
          if (!existing || existing.score < score) {
            scoredMap.set(label, {
              resolved: {
                state: item.State,
                lga: item.LGA,
                ward: item.Ward || '',
                label,
                lat: item.Latitude,
                lng: item.Longitude,
              },
              score,
            });
          }
        }
      }

      // 2. Search LGA/State Dataset
      Object.entries(LGAS_DATA).forEach(([st, lgas]) => {
        const stLower = st.toLowerCase();
        lgas.forEach((lga) => {
          const lgaLower = lga.toLowerCase();
          let score = 0;
          if (lgaLower === q) score = 950;
          else if (lgaLower.startsWith(q)) score = 750;
          else if (lgaLower.includes(q)) score = 450;
          else if (stLower === q || stLower.startsWith(q)) score = 250;
          else if (stLower.includes(q)) score = 80;

          if (score > 0) {
            const label = `${lga}, ${st} State`;
            const existing = scoredMap.get(label);
            if (!existing || existing.score < score) {
              scoredMap.set(label, {
                resolved: { state: st, lga, ward: '', label },
                score,
              });
            }
          }
        });
      });

      const localSorted = Array.from(scoredMap.values())
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.resolved)
        .slice(0, 6);

      const googleResults: ResolvedWard[] = (places.placePredictions || []).slice(0, 4).map((p) => ({
        state: '',
        lga: '',
        ward: '',
        label: p.description,
        place_id: p.place_id,
        isGooglePlace: true,
      }));

      setLocSuggestions([...googleResults, ...localSorted]);
      setLocSearching(false);
    }, 200);
  };

  const handleSelectLocSuggestion = async (item: ResolvedWard) => {
    setLocSuggestions([]);
    places.clearSuggestions();
    setLocError('');

    if (item.isGooglePlace && item.place_id) {
      setLocSearching(true);
      try {
        const details = await places.getPlaceDetails(item.place_id);
        const resolved: ResolvedWard = {
          state: details.state || 'Lagos',
          lga: details.lga || 'Ikeja',
          ward: details.ward || '',
          label: details.address || item.label,
          lat: details.geopoint?.latitude,
          lng: details.geopoint?.longitude,
        };
        setSelectedLoc(resolved);
        setLocQuery(resolved.label);
      } catch {
        setSelectedLoc(item);
        setLocQuery(item.label);
      } finally {
        setLocSearching(false);
      }
    } else {
      setSelectedLoc(item);
      setLocQuery(item.label);
    }
  };

  const toggleInterest = (interest: string) => {
    setSelectedInterests(prev =>
      prev.includes(interest) ? prev.filter(i => i !== interest) : [...prev, interest]
    );
  };

  const handleStep1Next = async () => {
    setUsernameErr('');
    const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase();
    if (cleanHandle) {
      const isAvail = await AuthService.checkUsernameAvailability(cleanHandle, user?.id);
      if (!isAvail) {
        setUsernameErr(`@${cleanHandle} is taken. Try another.`);
        return;
      }
    }

    let activeLoc = selectedLoc;
    if (!activeLoc && locQuery.trim()) {
      if (locSuggestions.length > 0) {
        activeLoc = locSuggestions[0];
        await handleSelectLocSuggestion(activeLoc);
      } else {
        const q = locQuery.trim().toLowerCase();
        const wardMatch = WARDS_DATA.find(
          (w) =>
            w.Ward?.toLowerCase() === q ||
            w.LGA?.toLowerCase() === q ||
            `${w.Ward}, ${w.LGA}, ${w.State}`.toLowerCase().includes(q)
        );
        if (wardMatch) {
          const label = `${wardMatch.Ward}, ${wardMatch.LGA}, ${wardMatch.State}`;
          activeLoc = { state: wardMatch.State, lga: wardMatch.LGA, ward: wardMatch.Ward, label, lat: wardMatch.Latitude, lng: wardMatch.Longitude };
          setSelectedLoc(activeLoc);
          setLocQuery(label);
        }
      }
    }

    if (!activeLoc) {
      setLocError('Please choose your neighbourhood location to proceed.');
      return;
    }
    setStep(2);
  };

  const handleComplete = async () => {
    if (!user || !selectedLoc) return;
    setLoading(true);
    setSaveError('');

    try {
      let avatarUrl = user.user_metadata?.avatar_url || null;

      if (avatarFile) {
        const fileExt = avatarFile.name.split('.').pop();
        const filePath = `${user.id}/${Date.now()}.${fileExt}`;
        const { error: uploadErr } = await supabase.storage
          .from('avatars')
          .upload(filePath, avatarFile, { upsert: true });

        if (!uploadErr) {
          const { data: pubUrlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
          avatarUrl = pubUrlData.publicUrl;
        }
      }

      const cleanHandle = handle.replace(/^@/, '').trim().toLowerCase() || user.email?.split('@')[0];
      const lat = selectedLoc.lat ?? gps.location?.lat ?? null;
      const lng = selectedLoc.lng ?? gps.location?.lng ?? null;

      await AuthService.updateUserProfile(user.id, {
        username: cleanHandle,
        bio: bio.trim(),
        avatar_url: avatarUrl,
        interests: selectedInterests,
        home_state: selectedLoc.state,
        home_lga: selectedLoc.lga,
        home_ward: selectedLoc.ward,
        home_lat: lat,
        home_lng: lng,
        ...(lat && lng ? { home_location_geom: `POINT(${lng} ${lat})` } : {}),
        onboarding_status: 'completed',
        profile_completed: true,
      } as any);

      router.replace('/onboarding/welcome');
    } catch (err: any) {
      setSaveError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] relative flex flex-col justify-between overflow-y-auto bg-[#050505] font-sans pb-10">
      <SceneBg photoId="1764921587464-f3cdd46fb4c9" pos="center 30%" gradientStart="40%" />

      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex items-center justify-between pt-8">
        <StepBar
          step={step}
          total={2}
          label={step === 1 ? 'Location & Identity' : 'Interests & Profile'}
        />
      </div>

      <div className="relative z-10 p-6 max-w-md w-full mx-auto my-auto">
        <GlassCard>
          {phoneSkipped && step === 1 && (
            <div className="flex items-center gap-2 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold mb-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>Phone verification skipped — add it later in Settings.</span>
            </div>
          )}

          {step === 1 ? (
            <>
              <div className="flex flex-col gap-1 text-left mb-4">
                <h2 className="text-2xl font-black text-white">Your Identity & Area</h2>
                <p className="text-sm font-normal text-white/55">
                  Set up your handle and neighbourhood to connect locally
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70 tracking-wider uppercase">
                    USERNAME HANDLE
                  </label>
                  <GlassInput
                    placeholder="e.g. john_doe"
                    value={handle}
                    onChange={(v) => setHandle(v)}
                  />
                  {usernameErr && <p className="text-xs text-red-400 font-medium">{usernameErr}</p>}
                </div>

                {/* Location Search */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70 tracking-wider uppercase">
                    YOUR NEIGHBOURHOOD (WARD / LGA)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search Ward or LGA..."
                      value={locQuery}
                      onChange={(e) => handleLocQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (locSuggestions.length > 0) {
                            handleSelectLocSuggestion(locSuggestions[0]);
                          }
                        }
                      }}
                      className="w-full h-12 px-4 pr-10 rounded-2xl bg-white/[0.055] border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-[#82DB7E] text-sm"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40">
                      {locSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                    </div>

                    {/* Location Suggestions Floating Dropdown */}
                    {locSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-[#161a16] border border-white/20 rounded-2xl overflow-hidden max-h-60 overflow-y-auto shadow-2xl backdrop-blur-xl">
                        {locSuggestions.map((item, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSelectLocSuggestion(item);
                            }}
                            onClick={() => {
                              handleSelectLocSuggestion(item);
                            }}
                            className="w-full text-left px-4 py-3 text-xs font-medium text-white/90 hover:bg-[#82DB7E]/20 hover:text-white transition-colors border-b border-white/5 last:border-0 flex items-center justify-between group"
                          >
                            <div className="flex items-center gap-2 min-w-0 pr-2">
                              <MapPin className="w-3.5 h-3.5 text-[#82DB7E] shrink-0" />
                              <span className="truncate">{item.label}</span>
                            </div>
                            {item.isGooglePlace ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 group-hover:bg-blue-500/30 shrink-0">
                                Google Place
                              </span>
                            ) : item.ward ? (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/10 text-white/70 group-hover:bg-[#82DB7E]/30 group-hover:text-[#82DB7E] shrink-0">
                                Ward
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* GPS & Manual Toggle Buttons */}
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => gps.detectLocation()}
                      disabled={gps.status === 'requesting' || gps.status === 'geocoding'}
                      className="flex items-center gap-1.5 text-xs font-semibold text-[#82DB7E] hover:underline disabled:opacity-50"
                    >
                      {gps.status === 'requesting' || gps.status === 'geocoding' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Navigation className="w-3.5 h-3.5" />
                      )}
                      <span>
                        {gps.status === 'requesting' || gps.status === 'geocoding'
                          ? 'Detecting GPS...'
                          : 'Auto-detect GPS Location'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowManualPick(!showManualPick)}
                      className="text-xs font-medium text-white/60 hover:text-white underline"
                    >
                      {showManualPick ? 'Hide manual picker' : 'Or select State & LGA'}
                    </button>
                  </div>

                  {showManualPick && (
                    <div className="space-y-3 pt-3 border-t border-white/10 mt-2 bg-white/[0.03] p-3 rounded-2xl">
                      <div>
                        <label className="text-[0.6875rem] font-bold text-white/60 uppercase tracking-wider block mb-1">
                          Select State
                        </label>
                        <select
                          value={manualState}
                          onChange={(e) => {
                            const st = e.target.value;
                            setManualState(st);
                            setManualLga('');
                            if (!st) { setSelectedLoc(null); }
                          }}
                          className="w-full h-11 px-3 rounded-xl bg-[#161a16] border border-white/20 text-white text-xs focus:outline-none focus:border-[#82DB7E]"
                        >
                          <option value="">-- Choose State --</option>
                          {STATES_DATA.map((st) => (
                            <option key={st} value={st} className="bg-[#161a16] text-white">{st}</option>
                          ))}
                        </select>
                      </div>

                      {manualState && (
                        <div>
                          <label className="text-[0.6875rem] font-bold text-white/60 uppercase tracking-wider block mb-1">
                            Select LGA
                          </label>
                          <select
                            value={manualLga}
                            onChange={(e) => {
                              const lga = e.target.value;
                              setManualLga(lga);
                              if (lga) {
                                const label = `${lga}, ${manualState} State`;
                                setSelectedLoc({ state: manualState, lga, ward: '', label });
                                setLocQuery(label);
                                setLocError('');
                              }
                            }}
                            className="w-full h-11 px-3 rounded-xl bg-[#161a16] border border-white/20 text-white text-xs focus:outline-none focus:border-[#82DB7E]"
                          >
                            <option value="">-- Choose Local Government --</option>
                            {(LGAS_DATA[manualState] || []).map((lga) => (
                              <option key={lga} value={lga} className="bg-[#161a16] text-white">{lga}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {locError && <p className="text-xs text-red-400 font-medium pt-1">{locError}</p>}

                  {selectedLoc && (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                      <MapPin className="w-4 h-4 shrink-0" />
                      <span className="truncate">Selected: {selectedLoc.label}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-4">
                <PrimaryBtn label="Continue" onClick={handleStep1Next} icon={<ArrowRight className="w-4 h-4" />} />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="p-1 rounded-full text-white/60 hover:text-white hover:bg-white/10"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-2xl font-black text-white">Personalize Profile</h2>
              </div>
              <p className="text-sm font-normal text-white/55 mb-4">
                Add an avatar, bio, and choose topics you care about
              </p>

              {/* Avatar Photo Picker */}
              <div className="flex flex-col items-center justify-center my-3">
                <label className="relative cursor-pointer group">
                  <input type="file" accept="image/*" onChange={handlePickAvatar} className="hidden" />
                  <div className="w-24 h-24 rounded-full bg-white/[0.055] border-2 border-white/10 flex items-center justify-center overflow-hidden transition-all group-hover:border-[#82DB7E]">
                    {avatarUri ? (
                      <Image src={avatarUri} alt="Avatar" width={96} height={96} className="object-cover w-full h-full" />
                    ) : (
                      <span className="text-3xl font-black text-white/40">
                        {user?.user_metadata?.name?.[0] || 'Y'}
                      </span>
                    )}
                  </div>
                  <div className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-[#82DB7E] text-[#050505] flex items-center justify-center shadow-lg border-2 border-[#050505]">
                    <Camera className="w-4 h-4" />
                  </div>
                </label>
                <span className="text-xs text-white/50 mt-2 font-medium">Upload profile picture</span>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70 tracking-wider uppercase">
                    SHORT BIO
                  </label>
                  <textarea
                    placeholder="Tell your neighbours a bit about yourself..."
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 rounded-2xl bg-white/[0.055] border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-[#82DB7E] text-sm resize-none"
                  />
                </div>

                {/* Interest Tags */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-white/70 tracking-wider uppercase flex items-center gap-1">
                    <Heart className="w-3.5 h-3.5 text-[#82DB7E]" />
                    <span>SELECT INTERESTS</span>
                  </label>
                  <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto p-1 scrollbar-none">
                    {FEATURED_INTERESTS.map((interest) => {
                      const isSelected = selectedInterests.includes(interest);
                      return (
                        <button
                          key={interest}
                          type="button"
                          onClick={() => toggleInterest(interest)}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                            isSelected
                              ? 'bg-[#82DB7E] text-[#050505] shadow-md scale-105'
                              : 'bg-white/10 text-white/70 hover:bg-white/20'
                          }`}
                        >
                          {interest}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {saveError && <p className="text-xs text-red-400 font-medium">{saveError}</p>}
              </div>

              <div className="pt-4">
                <PrimaryBtn label="Complete Profile" onClick={handleComplete} loading={loading} />
              </div>
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

export default function OnboardingProfilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-[100dvh] bg-[#050505] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#82DB7E] animate-spin" />
      </div>
    }>
      <OnboardingProfileContent />
    </Suspense>
  );
}
