"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { SceneBg, GlassCard, GlassInput, StepBar, PrimaryBtn } from '@/components/onboarding/primitives';
import { AuthService } from '@/lib/auth-service';
import { useAuth } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase';
import { useGpsLocation } from '@/hooks/use-gps-location';
import { Camera, MapPin, Navigation, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';


interface ResolvedWard { state: string; lga: string; ward: string; label: string; }

function OnboardingProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phoneSkipped = searchParams.get('phoneSkipped') === 'true';
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const gps = useGpsLocation();

  // Step 1 State
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [usernameErr, setUsernameErr] = useState('');

  // Step 2 State
  const [locQuery, setLocQuery] = useState('');
  const [locSuggestions, setLocSuggestions] = useState<ResolvedWard[]>([]);
  const [locSearching, setLocSearching] = useState(false);
  const [selectedLoc, setSelectedLoc] = useState<ResolvedWard | null>(null);
  const [locError, setLocError] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Auto-fill from GPS result when it arrives
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

  // Debounced live search against lga_wards table
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
    setStep(2);
  };

  const handleComplete = async () => {
    if (!user) return;
    if (!selectedLoc) { setLocError('Please choose your neighbourhood to continue.'); return; }
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
          label={step === 1 ? 'Personalize' : 'Your Neighbourhood'}
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
              <div className="flex flex-col gap-1 text-left">
                <h2 className="text-2xl font-black text-white">Set up your profile</h2>
                <p className="text-sm font-normal text-white/55">
                  Neighbours like knowing who they are talking to
                </p>
              </div>

              {/* Avatar Photo Picker */}
              <div className="flex flex-col items-center justify-center my-2">
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
                <span className="text-xs text-white/70 font-semibold mt-2">Tap to add photo</span>
              </div>

              {usernameErr && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                  {usernameErr}
                </div>
              )}

              <GlassInput
                placeholder="Choose handle (e.g. johndoe)"
                value={handle}
                onChange={v => setHandle(v.replace(/^@/, ''))}
              />

              <div className="relative">
                <textarea
                  placeholder="Short bio for neighbours (optional)"
                  value={bio}
                  onChange={e => setBio(e.target.value.slice(0, 140))}
                  rows={3}
                  className="w-full p-4 rounded-[18px] bg-white/[0.07] border border-white/15 text-white text-base placeholder:text-white/60 focus:outline-none focus:border-[#82DB7E]/80 focus:ring-1 focus:ring-[#82DB7E]/50 resize-none"
                />
                <span className="absolute bottom-3 right-4 text-xs text-white/70 font-bold">
                  {bio.length}/140
                </span>
              </div>

              <PrimaryBtn label="Next: Choose Neighbourhood →" onClick={handleStep1Next} />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1 text-left">
                <h2 className="text-2xl font-black text-white">Where do you live?</h2>
                <p className="text-sm font-normal text-white/70">
                  We use your general area to show local posts, events &amp; marketplace items
                </p>
              </div>

              <div className="relative flex flex-col gap-2">
                <GlassInput
                  placeholder="Search ward, LGA or state..."
                  value={locQuery}
                  onChange={handleLocQuery}
                  icon={locSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                />

                {/* Live autocomplete dropdown */}
                {locSuggestions.length > 0 && !selectedLoc && (
                  <div className="w-full bg-[#141414] border border-white/15 rounded-[18px] p-2 flex flex-col gap-1 max-h-48 overflow-y-auto shadow-2xl z-20">
                    {locSuggestions.map(s => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => { setSelectedLoc(s); setLocQuery(s.label); setLocSuggestions([]); }}
                        className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-left text-sm font-medium text-white hover:bg-[#82DB7E]/15 hover:text-[#82DB7E] transition-all"
                      >
                        <MapPin className="w-3.5 h-3.5 text-[#82DB7E]" />
                        <span>{s.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={gps.detectLocation}
                disabled={gps.status === 'requesting' || gps.status === 'geocoding'}
                className="w-full h-12 rounded-[18px] bg-white/[0.08] border border-white/15 text-white font-semibold text-sm flex items-center justify-center gap-2 hover:bg-white/15 transition-all active:scale-98 disabled:opacity-60"
              >
                {gps.status === 'requesting' || gps.status === 'geocoding' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#82DB7E]" />
                ) : (
                  <Navigation className="w-4 h-4 text-[#82DB7E]" />
                )}
                <span>
                  {gps.status === 'requesting' ? 'Requesting permission...' :
                   gps.status === 'geocoding' ? 'Resolving location...' :
                   gps.status === 'success' ? 'Location detected ✓' :
                   'Use Current Location (GPS)'}
                </span>
              </button>

              {(locError || saveError) && (
                <div className="flex items-center gap-2 p-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span>{locError || saveError}</span>
                </div>
              )}

              {/* Privacy Card */}
              <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-xs text-white/55">
                <ShieldCheck className="w-4 h-4 text-[#82DB7E] flex-shrink-0 mt-0.5" />
                <span>Exact house numbers are kept private. Neighbours only see your area.</span>
              </div>

              <PrimaryBtn
                label="Complete Setup & Join"
                onClick={handleComplete}
                disabled={!selectedLoc}
                loading={loading}
              />
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}

export default function OnboardingProfilePage() {
  return (
    <React.Suspense fallback={<div className="min-h-[100dvh] bg-[#050505]" />}>
      <OnboardingProfileContent />
    </React.Suspense>
  );
}
