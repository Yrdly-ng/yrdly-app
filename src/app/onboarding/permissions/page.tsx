"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo, PrimaryBtn } from '@/components/onboarding/primitives';
import { useAuth } from '@/hooks/use-supabase-auth';
import { MapPin, Bell, Camera, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PermissionsPage() {
  const router = useRouter();
  const { updateProfile } = useAuth();
  const [perms, setPerms] = useState({ location: false, notifications: false, camera: false });
  const [loading, setLoading] = useState(false);

  const handleFinish = async () => {
    setLoading(true);
    try {
      await updateProfile({ profile_completed: true });
    } catch {
      // Profile completion fallback
    }
    router.replace('/home');
  };

  const togglePermission = async (key: keyof typeof perms) => {
    if (perms[key]) {
      setPerms(prev => ({ ...prev, [key]: false }));
      return;
    }

    if (key === 'location' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        () => setPerms(prev => ({ ...prev, location: true })),
        () => setPerms(prev => ({ ...prev, location: false }))
      );
    } else if (key === 'notifications' && 'Notification' in window) {
      const res = await Notification.requestPermission();
      setPerms(prev => ({ ...prev, notifications: res === 'granted' }));
    } else {
      setPerms(prev => ({ ...prev, [key]: !prev[key] }));
    }
  };

  const items = [
    { key: 'location' as const, icon: <MapPin className="w-5 h-5 text-[#82DB7E]" />, title: 'Location Access', desc: 'To show you nearby neighbours, events & marketplace items' },
    { key: 'notifications' as const, icon: <Bell className="w-5 h-5 text-[#82DB7E]" />, title: 'Push Notifications', desc: 'To alert you when neighbours message or post nearby' },
    { key: 'camera' as const, icon: <Camera className="w-5 h-5 text-[#82DB7E]" />, title: 'Camera & Photos', desc: 'To list items in marketplace and post community photos' },
  ];

  return (
    <div className="min-h-[100dvh] relative flex flex-col justify-between overflow-y-auto bg-[#050505] font-sans pb-10">
      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex flex-col items-center text-center pt-10 gap-3">
        <Logo size={56} />
        <h2 className="text-2xl font-black text-white leading-tight">
          Enable permissions for the best experience
        </h2>
        <p className="text-sm font-normal text-white/55">
          YRDLY works best with these on. You can change them anytime in Settings.
        </p>
      </div>

      {/* Card Stack */}
      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex flex-col gap-3 my-auto">
        {items.map(item => (
          <div
            key={item.key}
            onClick={() => togglePermission(item.key)}
            className={cn(
              "p-5 rounded-[24px] bg-white/[0.04] border transition-all flex items-center justify-between gap-4 cursor-pointer hover:bg-white/[0.07]",
              perms[item.key] ? "border-[#82DB7E]/40 shadow-[0_4px_20px_rgba(130,219,126,0.15)]" : "border-white/10"
            )}
          >
            <div className="flex items-start gap-3.5">
              <div
                className={cn(
                  "p-3 rounded-2xl flex items-center justify-center transition-all",
                  perms[item.key] ? "bg-[#82DB7E]/10" : "bg-white/[0.04]"
                )}
              >
                {item.icon}
              </div>
              <div className="flex flex-col gap-0.5 text-left">
                <h3 className="text-base font-bold text-white">{item.title}</h3>
                <p className="text-xs text-white/55 leading-relaxed">{item.desc}</p>
              </div>
            </div>

            {/* Toggle Switch */}
            <div
              className={cn(
                "w-12 h-7 rounded-full p-1 transition-all flex items-center relative flex-shrink-0",
                perms[item.key] ? "bg-[#82DB7E]" : "bg-white/10"
              )}
            >
              <div
                className={cn(
                  "w-5 h-5 rounded-full bg-[#050505] transition-all flex items-center justify-center",
                  perms[item.key] ? "translate-x-5" : "translate-x-0"
                )}
              >
                {perms[item.key] && <Check className="w-3 h-3 text-[#82DB7E]" />}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="relative z-10 p-6 max-w-md w-full mx-auto pb-8">
        <PrimaryBtn
          label="Allow Selected & Continue"
          onClick={handleFinish}
          loading={loading}
        />
      </div>
    </div>
  );
}
