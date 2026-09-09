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

interface ResolvedWard { state: string; lga: string; ward: string; label: string; }

function OnboardingProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phoneSkipped = searchParams.get('phoneSkipped') === 'true';
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const gps = useGpsLocation();

  // Step 1 State: Identity & Location
  const [handle, setHandle] = useState('');
  const [usernameErr, setUsernameErr] = useState('');
  const [locQuery, setLocQuery] = useState('');
  const [locSuggestions, setLocSuggestions] = useState<ResolvedWard[]>([]);
  const [locSearching, setLocSearching] = useState(false);
  const [selectedLoc, setSelectedLoc] = useState<ResolvedWard | null>(null);
  const [locError, setLocError] = useState('');

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
      const { state, lga, ward, displayAddress } = gps.location;
      const resolved: ResolvedWard = { state, lga, ward, label: `${ward}, ${lga}, ${state}` };
      setSelectedLoc(resolved);
      setLocQuery(displayAddress || resolved.label);
    } else if (gps.status === 'denied' || gps.status === 'error' || gps.status === 'timeout') {
      setLocError(gps.error || 'Could not detect location. Please select manually.');
    }
  }, [gps.status, gps.location, gps.error]);

  const handleLocQuery = (v: string) => {
    setLocQuery(v);
    setSelectedLoc(null);
    setLocError('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!v.trim()) { setLocSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLocSearching(true);
      const { data } = await supabase
        .from('lga_wards')
        .select('ward_name, lga_name, state_name')
        .or(`ward_name.ilike.%${v}%,lga_name.ilike.%${v}%,state_name.ilike.%${v}%`)
        .limit(8);
      setLocSuggestions(
        (data || []).map((r: any) => ({
          state: r.state_name,
          lga: r.lga_name,
          ward: r.ward_name,
          label: `${r.ward_name}, ${r.lga_name}, ${r.state_name}`,
        }))
      );
      setLocSearching(false);
    }, 300);
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
    if (!selectedLoc) {
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
      const lat = gps.location?.lat ?? null;
      const lng = gps.location?.lng ?? null;

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
                      className="w-full h-12 px-4 pr-10 rounded-2xl bg-white/[0.055] border border-white/10 text-white placeholder-white/40 focus:outline-none focus:border-[#82DB7E] text-sm"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40">
                      {locSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                    </div>
                  </div>

                  {/* GPS Auto-detect Button */}
                  <button
                    type="button"
                    onClick={() => gps.detectLocation()}
                    className="flex items-center gap-2 text-xs font-semibold text-[#82DB7E] hover:underline pt-1"
                  >
                    <Navigation className="w-3.5 h-3.5" />
                    <span>Auto-detect GPS Location</span>
                  </button>

                  {locError && <p className="text-xs text-red-400 font-medium pt-1">{locError}</p>}

                  {/* Location Suggestions List */}
                  {locSuggestions.length > 0 && (
                    <div className="mt-2 bg-[#121212] border border-white/10 rounded-2xl overflow-hidden max-h-48 overflow-y-auto">
                      {locSuggestions.map((item, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSelectedLoc(item);
                            setLocQuery(item.label);
                            setLocSuggestions([]);
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-white/80 hover:bg-white/10 transition-colors border-b border-white/5 last:border-0"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedLoc && (
                    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
                      <MapPin className="w-4 h-4 shrink-0" />
                      <span className="truncate">{selectedLoc.label}</span>
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
