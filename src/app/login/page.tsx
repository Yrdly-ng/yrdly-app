"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Logo,
  SceneBg,
  GlassCard,
  GlassInput,
  PasswordStrength,
  PrimaryBtn,
  Divider,
} from '@/components/onboarding/primitives';
import { AuthService } from '@/lib/auth-service';
import { useAuth } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase';
import { User, AtSign, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import posthog from 'posthog-js';

const isPasswordStrong = (pwd: string) =>
  pwd.length >= 8 && /[A-Z]/.test(pwd) && /[0-9]/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signUp, signInWithGoogle } = useAuth();

  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    setError('');
    const { error: err } = await signInWithGoogle();
    if (err) setError(err.message);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (isSignUp && (!name || !username))) {
      setError('Please fill in all required fields');
      return;
    }

    if (isSignUp && !isPasswordStrong(password)) {
      setError('Please create a strong password meeting all 4 requirements below');
      return;
    }

    setError('');
    setLoading(true);

    try {
      if (!isSignUp) {
        const { user: signedUser, error: err } = await signIn(email, password);
        if (err) {
          if (err.message.toLowerCase().includes('email not confirmed') || err.message.toLowerCase().includes('unconfirmed')) {
            try {
              await supabase.auth.resend({ type: 'signup', email });
            } catch {}
            router.push(`/onboarding/verify-email?email=${encodeURIComponent(email)}`);
            return;
          }
          setError(err.message);
        } else if (signedUser) {
          posthog.identify(signedUser.id, { email: signedUser.email });
          posthog.capture('user_signed_in', { method: 'email' });
          router.push('/home');
        }
      } else {
        const cleanUsername = username.replace(/^@/, '').trim().toLowerCase();
        const isAvailable = await AuthService.checkUsernameAvailability(cleanUsername);
        if (!isAvailable) {
          setError(`The username @${cleanUsername} is already taken. Please choose another.`);
          setLoading(false);
          return;
        }

        const { user: newUser, error: err } = await signUp(email, password, name, cleanUsername);
        if (err) {
          if (err.message.toLowerCase().includes('already registered') || err.message.toLowerCase().includes('already in use')) {
            try {
              await supabase.auth.resend({ type: 'signup', email });
            } catch {}
            router.push(`/onboarding/verify-email?email=${encodeURIComponent(email)}`);
            return;
          }
          setError(err.message);
        } else if (newUser) {
          posthog.identify(newUser.id, { email: newUser.email, name });
          posthog.capture('user_signed_up', { method: 'email' });
          if (newUser.email_confirmed_at) router.push('/home');
          else router.push(`/onboarding/verify-email?email=${encodeURIComponent(email)}`);
        }
      }
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] relative flex flex-col justify-between overflow-y-auto bg-[#050505] font-sans pb-10">
      <SceneBg photoId="1571346746462-d4e51c41072f" pos="center 30%" gradientStart="40%" />

      <div className="relative z-10 p-6 max-w-md w-full mx-auto flex items-center justify-center pt-8">
        <Logo size={44} />
      </div>

      <div className="relative z-10 p-6 max-w-md w-full mx-auto my-auto">
        <GlassCard>
          {/* Header */}
          <div className="flex flex-col gap-1 text-left">
            <h2 className="text-2xl font-black text-white">
              {isSignUp ? 'Join your neighbourhood' : 'Welcome back'}
            </h2>
            <p className="text-sm font-normal text-white/55">
              {isSignUp
                ? 'Create your account — it only takes a moment'
                : 'Sign in to your neighbourhood'}
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
              {error}
            </div>
          )}

          <form onSubmit={handleAuth} className="flex flex-col gap-4">
            {isSignUp && (
              <>
                <GlassInput
                  placeholder="Full name"
                  value={name}
                  onChange={setName}
                  icon={<User className="w-4 h-4" />}
                />
                <GlassInput
                  placeholder="Username (e.g. johndoe)"
                  value={username}
                  onChange={setUsername}
                  icon={<AtSign className="w-4 h-4" />}
                />
              </>
            )}

            <GlassInput
              type="email"
              placeholder="Email address"
              value={email}
              onChange={setEmail}
              icon={<Mail className="w-4 h-4" />}
            />

            <GlassInput
              type={showPassword ? 'text' : 'password'}
              placeholder={isSignUp ? 'Create a password' : 'Password'}
              value={password}
              onChange={setPassword}
              icon={<Lock className="w-4 h-4" />}
              right={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-white/40 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />

            {isSignUp && <PasswordStrength value={password} />}

            <div className="pt-2">
              <PrimaryBtn
                type="submit"
                label={isSignUp ? 'Create Account' : 'Sign In'}
                loading={loading}
              />
            </div>
          </form>

          <Divider label="OR CONTINUE WITH" />

          {/* Social Row */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleGoogle}
              className="flex-1 h-12 rounded-[18px] bg-white/[0.055] border border-white/10 text-white font-medium text-sm flex items-center justify-center gap-2 hover:bg-white/10 transition-all active:scale-98"
            >
              <span>Google</span>
            </button>
          </div>

          {/* Toggle Switch Pill */}
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => { setIsSignUp(!isSignUp); setError(''); }}
              className="text-xs text-white/38 hover:text-white transition-colors"
            >
              {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
              <span className="text-[#82DB7E] font-bold">{isSignUp ? 'Sign in' : 'Sign up'}</span>
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
