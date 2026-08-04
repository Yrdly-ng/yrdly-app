"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { ONBOARDING_THEME } from '@/constants/onboarding-theme';
import { ChevronLeft, CheckCircle, Circle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

const { colors } = ONBOARDING_THEME;

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <div className="relative overflow-hidden flex items-center justify-center" style={{ width: size, height: size, borderRadius: size * 0.28 }}>
      <Image
        src="/logo.png"
        alt="Yrdly"
        width={size}
        height={size}
        className="object-contain"
      />
    </div>
  );
}

const LOCAL_SCENE_IMAGES: Record<string, string> = {
  '1594538756542-8c88bda491c5': '/images/onboarding/splash.jpg',
  '1752622176337-5d9315e2df6e': '/images/onboarding/slide1.jpg',
  '1579998120708-682dd8a5624f': '/images/onboarding/slide2.jpg',
  '1673280401347-309363111070': '/images/onboarding/slide3.jpg',
  '1758525225816-8dd1901ef6ec': '/images/onboarding/slide4.jpg',
  '1571346746462-d4e51c41072f': '/images/onboarding/signup.jpg',
  '1707011017057-e80acf66ddeb': '/images/onboarding/auth_bg.jpg',
  '1768244016593-8ca75b15bc92': '/images/onboarding/verify_email.jpg',
  '1654762550505-7c58277e0fac': '/images/onboarding/phone_bg.jpg',
  '1764921587464-f3cdd46fb4c9': '/images/onboarding/profile_bg.jpg',
};

export function SceneBg({ photoId, pos = 'center', gradientStart = '40%' }: { photoId: string; pos?: string; gradientStart?: string }) {
  const imageSrc = LOCAL_SCENE_IMAGES[photoId] || `/images/onboarding/splash.jpg`;

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0 bg-[#050505]">
      <Image
        src={imageSrc}
        alt="Background Scene"
        fill
        priority
        className="object-cover"
        style={{ objectPosition: pos }}
      />
      <div
        className="absolute inset-0"
        style={{ backgroundColor: 'rgba(5,5,5,0.86)' }}
      />
    </div>
  );
}

export function GlassCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "w-full max-w-md mx-auto p-7 md:p-8 rounded-[32px] flex flex-col gap-5 backdrop-blur-xl relative z-10 transition-all border border-white/15 shadow-2xl",
        className
      )}
      style={{ backgroundColor: 'rgba(12,12,12,0.88)' }}
    >
      {children}
    </div>
  );
}

export function GlassInput({
  type = 'text',
  placeholder,
  value,
  onChange,
  icon,
  right,
  maxLength,
}: {
  type?: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div
      className={cn(
        "flex items-center px-4 h-14 rounded-[18px] bg-white/[0.07] border transition-all relative",
        focused ? "border-[#82DB7E]/80 ring-1 ring-[#82DB7E]/50" : "border-white/15"
      )}
    >
      {icon && <div className="mr-3 text-white/60">{icon}</div>}
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        maxLength={maxLength}
        className="w-full bg-transparent text-white text-base placeholder:text-white/60 focus:outline-none"
      />
      {right}
    </div>
  );
}

export function PrimaryBtn({ label, onClick, icon, disabled, loading, type = 'button' }: { label: string; onClick?: () => void; icon?: React.ReactNode; disabled?: boolean; loading?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "w-full h-14 rounded-[20px] bg-[#82DB7E] text-[#050505] font-black text-base flex items-center justify-center gap-2 shadow-[0_8px_30px_rgba(130,219,126,0.26)] transition-all active:scale-98 hover:scale-[1.01]",
        (disabled || loading) && "opacity-50 cursor-not-allowed shadow-none"
      )}
    >
      {icon}
      <span>{loading ? 'Processing...' : label}</span>
    </button>
  );
}

export function SecondaryBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-12 rounded-[18px] bg-white/[0.08] border border-white/15 text-white font-semibold text-sm transition-all hover:bg-white/15 active:scale-98"
    >
      {label}
    </button>
  );
}

export function PasswordStrength({ value }: { value: string }) {
  const reqs = [
    { label: '8+ characters', met: value.length >= 8 },
    { label: 'Uppercase letter (A-Z)', met: /[A-Z]/.test(value) },
    { label: 'Number (0-9)', met: /[0-9]/.test(value) },
    { label: 'Special symbol (!@#$)', met: /[^A-Za-z0-9]/.test(value) },
  ];
  const score = reqs.filter(r => r.met).length;
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  const colorsList = ['', '#FF5C5C', '#FFB648', '#82DB7E', '#82DB7E'];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-1 max-w-[180px]">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="h-1.5 flex-1 rounded-full transition-all"
              style={{ backgroundColor: i <= score ? colorsList[score] : 'rgba(255,255,255,0.15)' }}
            />
          ))}
        </div>
        <span className="text-xs font-bold" style={{ color: score > 0 ? colorsList[score] : 'rgba(255,255,255,0.6)' }}>
          {labels[score]}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {reqs.map(r => (
          <div
            key={r.label}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all",
              r.met ? "bg-[#82DB7E]/15 text-[#82DB7E] border-[#82DB7E]/40" : "bg-white/[0.06] text-white/70 border-white/10"
            )}
          >
            {r.met ? <CheckCircle className="w-3 h-3 text-[#82DB7E]" /> : <Circle className="w-3 h-3 text-white/50" />}
            <span>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BackBtn({ onClick, light }: { onClick: () => void; light?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-sm font-bold text-white transition-colors hover:text-white/80"
    >
      <ChevronLeft className="w-4 h-4 text-white" />
      <span>Back</span>
    </button>
  );
}

export function ProgressPills({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-2">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-1.5 rounded-full transition-all duration-500"
          style={{
            width: i === current ? 24 : 8,
            backgroundColor: i === current ? '#82DB7E' : 'rgba(255,255,255,0.35)',
          }}
        />
      ))}
    </div>
  );
}

export function StepBar({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className="w-full flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-extrabold uppercase tracking-wider text-white">STEP {step} OF {total}</span>
        <span className="font-extrabold text-white">{label}</span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden">
        <div
          className="h-full bg-[#82DB7E] transition-all duration-500"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-1">
      <div className="flex-1 h-px bg-white/15" />
      <span className="text-[10px] font-black uppercase tracking-widest text-white/70">{label}</span>
      <div className="flex-1 h-px bg-white/15" />
    </div>
  );
}
