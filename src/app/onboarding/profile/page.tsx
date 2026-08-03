"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { SceneBg, GlassCard, GlassInput, StepBar, PrimaryBtn } from '@/components/onboarding/primitives';
import { AuthService } from '@/lib/auth-service';
import { useAuth } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase';
import { Camera, MapPin, Navigation, ShieldCheck, AlertTriangle } from 'lucide-react';

const SUGGESTIONS = ['Victoria Island, Lagos', 'Lekki Phase 1, Lagos', 'Surulere, Lagos', 'Ikeja GRA, Lagos'];

export default function OnboardingProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phoneSkipped = searchParams.get('phoneSkipped') === 'true';
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 State
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [handle, setHandle] = useState('');
  const [bio, setBio] = useState('');
  const [usernameErr, setUsernameErr] = useState('');

  // Step 2 State
  const [location, setLocation] = useState('');
  const [selectedLoc, setSelectedLoc] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [loading, setLoading] = useState(false);

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

  const handleUseGPS = async () => {
    setLocLoading(true);
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => {
          setLocation('Victoria Island, Lagos');
          setSelectedLoc(true);
          setLocLoading(false);
        },
        () => {
          setLocation('Victoria Island, Lagos');
          setSelectedLoc(true);
          setLocLoading(false);
        }
      );
    } else {
      setLocation('Victoria Island, Lagos');
      setSelectedLoc(true);
      setLocLoading(false);
    }
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
    setLoading(true);

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

      await AuthService.updateUserProfile(user.id, {
        username: cleanHandle,
        bio: bio.trim(),
        avatar_url: avatarUrl,
        location: location.trim() || 'Victoria Island, Lagos',
        onboarding_status: 'completed',
        profile_completed: false,
      });

      router.push('/onboarding/permissions');
    } catch {
      router.push('/onboarding/permissions');
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
                <span className="text-xs text-white/38 mt-2">Tap to add photo</span>
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
                  className="w-full p-4 rounded-[18px] bg-white/[0.055] border border-white/10 text-white text-base placeholder:text-white/38 focus:outline-none focus:border-[#82DB7E]/60 focus:ring-1 focus:ring-[#82DB7E]/30 resize-none"
                />
                <span className="absolute bottom-3 right-4 text-xs text-white/38 font-medium">
                  {bio.length}/140
                </span>
              </div>

              <PrimaryBtn label="Next: Choose Neighbourhood →" onClick={handleStep1Next} />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1 text-left">
                <h2 className="text-2xl font-black text-white">Where do you live?</h2>
                <p className="text-sm font-normal text-white/55">
                  We use your general area to show local posts, events & marketplace items
                </p>
              </div>

              <GlassInput
                placeholder="Search district or neighbourhood..."
                value={location}
                onChange={v => { setLocation(v); setSelectedLoc(false); }}
                icon={<MapPin className="w-4 h-4" />}
              />

              <button
                type="button"
                onClick={handleUseGPS}
                disabled={locLoading}
                className="w-full h-12 rounded-[18px] bg-white/[0.055] border border-white/10 text-white font-medium text-sm flex items-center justify-center gap-2 hover:bg-white/10 transition-all active:scale-98"
              >
                <Navigation className="w-4 h-4 text-[#82DB7E]" />
                <span>{locLoading ? 'Locating...' : 'Use Current Location (GPS)'}</span>
              </button>

              {/* Suggestions */}
              {!selectedLoc && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-white/38 uppercase tracking-wider">Popular Areas</span>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => { setLocation(s); setSelectedLoc(true); }}
                        className="px-3.5 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs font-medium text-white/80 hover:bg-white/10 transition-all"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
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
                disabled={!location.trim()}
                loading={loading}
              />
            </>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
