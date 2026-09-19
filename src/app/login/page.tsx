"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthService } from "@/lib/auth-service";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { User, AtSign, Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import posthog from "@/lib/posthog";

const isPasswordStrong = (pwd: string) =>
  pwd.length >= 8 && /[A-Z]/.test(pwd) && /[0-9]/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);

function PasswordStrengthIndicator({ value }: { value: string }) {
  if (!value) return null;
  const hasMinLen = value.length >= 8;
  const hasUpper = /[A-Z]/.test(value);
  const hasNum = /[0-9]/.test(value);
  const hasSpecial = /[^A-Za-z0-9]/.test(value);

  const checks = [
    { label: "8+ chars", met: hasMinLen },
    { label: "Uppercase", met: hasUpper },
    { label: "Number", met: hasNum },
    { label: "Special char", met: hasSpecial },
  ];

  return (
    <div className="grid grid-cols-2 gap-1.5 pt-1 text-xs">
      {checks.map((c) => (
        <div key={c.label} className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              c.met ? "bg-[#82DB7E]" : "bg-white/20"
            }`}
          />
          <span className={c.met ? "text-[#82DB7E]" : "text-white/40"}>
            {c.label}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { user, profile, loading: authLoading, signIn, signUp, signInWithGoogle } = useAuth();

  const [isSignUp, setIsSignUp] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && user) {
      if (profile?.profile_completed) {
        router.replace("/home");
      } else {
        router.replace("/onboarding/profile");
      }
    }
  }, [user, profile, authLoading, router]);

  const handleGoogle = async () => {
    setError("");
    const { error: err } = await signInWithGoogle();
    if (err) setError(err.message);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || (isSignUp && (!name || !username))) {
      setError("Please fill in all required fields");
      return;
    }

    if (isSignUp && !isPasswordStrong(password)) {
      setError("Please create a strong password meeting all 4 requirements below");
      return;
    }

    setError("");
    setLoading(true);

    try {
      if (!isSignUp) {
        const { user: signedUser, error: err } = await signIn(email, password);
        if (err) {
          if (
            err.message.toLowerCase().includes("email not confirmed") ||
            err.message.toLowerCase().includes("unconfirmed")
          ) {
            try {
              await supabase.auth.resend({ type: "signup", email });
            } catch {}
            router.push(`/onboarding/verify-email?email=${encodeURIComponent(email)}`);
            return;
          }
          setError(err.message);
        } else if (signedUser) {
          posthog.identify(signedUser.id, { email: signedUser.email });
          posthog.capture("user_signed_in", { method: "email" });
          router.push("/home");
        }
      } else {
        const cleanUsername = username.replace(/^@/, "").trim().toLowerCase();
        const isAvailable = await AuthService.checkUsernameAvailability(cleanUsername);
        if (!isAvailable) {
          setError(`The username @${cleanUsername} is already taken. Please choose another.`);
          setLoading(false);
          return;
        }

        const { user: newUser, error: err } = await signUp(email, password, name, cleanUsername);
        if (err) {
          if (
            err.message.toLowerCase().includes("already registered") ||
            err.message.toLowerCase().includes("already in use")
          ) {
            try {
              await supabase.auth.resend({ type: "signup", email });
            } catch {}
            router.push(`/onboarding/verify-email?email=${encodeURIComponent(email)}`);
            return;
          }
          setError(err.message);
        } else if (newUser) {
          posthog.identify(newUser.id, { email: newUser.email, name });
          posthog.capture("user_signed_up", { method: "email" });
          if (newUser.email_confirmed_at) router.push("/home");
          else router.push(`/onboarding/verify-email?email=${encodeURIComponent(email)}`);
        }
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full bg-[#0b0c0f] text-foreground flex flex-col lg:flex-row overflow-x-hidden font-yrdly-body select-none">
      {/* ── Left Hero Panel (Instagram Style Showcase) ── */}
      <div className="hidden lg:flex flex-1 flex-col justify-between p-12 lg:p-16 bg-[#08090b] relative overflow-hidden border-r border-white/5">
        {/* Top Brand Logo */}
        <div className="flex items-center gap-2 z-10">
          <span className="font-yrdly-display font-black text-3xl tracking-tight text-[#82DB7E]">
            YRDLY
          </span>
        </div>

        {/* Hero Content */}
        <div className="flex flex-col items-center text-center my-auto z-10 max-w-md mx-auto space-y-8">
          <h1 className="text-4xl xl:text-5xl font-extrabold text-white leading-tight font-yrdly-display tracking-tight">
            See everyday moments from your{" "}
            <span className="bg-gradient-to-r from-[#FFD600] via-[#82DB7E] to-[#00D078] bg-clip-text text-transparent">
              neighbourhood.
            </span>
          </h1>

          {/* Instagram-style stacked visual card preview */}
          <div className="relative w-72 h-80 flex items-center justify-center pt-4">
            {/* Card 1 (Back Left) */}
            <div className="absolute top-2 -left-4 w-48 h-64 rounded-3xl bg-card border border-white/10 p-3 shadow-2xl transform -rotate-12 transition-transform hover:-rotate-6">
              <div className="w-full h-32 rounded-2xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                <span className="text-2xl">🎉</span>
              </div>
              <div className="mt-3 space-y-1 text-left">
                <div className="h-3 w-24 bg-white/20 rounded-full" />
                <div className="h-2 w-32 bg-white/10 rounded-full" />
              </div>
            </div>

            {/* Card 2 (Back Right) */}
            <div className="absolute top-4 -right-4 w-48 h-64 rounded-3xl bg-card border border-white/10 p-3 shadow-2xl transform rotate-12 transition-transform hover:rotate-6">
              <div className="w-full h-32 rounded-2xl bg-gradient-to-br from-amber-500/20 to-emerald-500/20 flex items-center justify-center">
                <span className="text-2xl">🛍️</span>
              </div>
              <div className="mt-3 space-y-1 text-left">
                <div className="h-3 w-28 bg-white/20 rounded-full" />
                <div className="h-2 w-20 bg-white/10 rounded-full" />
              </div>
            </div>

            {/* Card 3 (Center Main) */}
            <div className="relative w-56 h-72 rounded-3xl bg-[#14171d] border border-[#82DB7E]/30 p-4 shadow-2xl z-20 flex flex-col justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-[#82DB7E]/20 border border-[#82DB7E] flex items-center justify-center text-[#82DB7E] font-bold text-xs">
                  Y
                </div>
                <div className="text-left min-w-0 flex-1">
                  <div className="text-xs font-bold text-white truncate font-yrdly-display">
                    Local Neighbourhood
                  </div>
                  <div className="text-[10px] text-[var(--yrdly-label)] truncate">
                    📍 Lagos, Nigeria
                  </div>
                </div>
              </div>

              <div className="my-2 rounded-2xl overflow-hidden bg-emerald-950/40 border border-[#82DB7E]/20 p-3 text-left">
                <p className="text-xs text-white/90 leading-snug font-yrdly-body">
                  &quot;Fresh organic produce available right around the block! 🌱&quot;
                </p>
              </div>

              <div className="flex items-center justify-between text-xs text-[var(--yrdly-label)] pt-1 border-t border-white/5">
                <span className="text-[#82DB7E] font-bold">❤️ 24 likes</span>
                <span>Just now</span>
              </div>
            </div>
          </div>
        </div>

        <div className="z-10 text-xs text-white/30 text-center font-mono">
          © {new Date().getFullYear()} YRDLY Inc.
        </div>
      </div>

      {/* ── Right Auth Panel (Instagram Style Form) ── */}
      <div
        className="flex-1 min-h-[100dvh] flex flex-col justify-between p-6 sm:p-10 lg:p-14 relative bg-cover bg-center"
        style={{ backgroundImage: "url('/images/onboarding/signup.jpg')" }}
      >
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-0" />

        <div className="relative z-10 flex-1 flex flex-col justify-between max-w-lg w-full mx-auto">
          {/* Top Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="lg:hidden font-yrdly-display font-black text-2xl text-[#82DB7E]">
                YRDLY
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp);
                setError("");
              }}
              className="text-xs font-bold text-[#82DB7E] hover:underline"
            >
              {isSignUp ? "Log in" : "Sign up"}
            </button>
          </div>

          {/* Form Container */}
          <div className="my-auto py-8 space-y-6 max-w-md w-full mx-auto">
          {/* Form Header */}
          <div className="space-y-1.5 text-left">
            <h2 className="text-2xl sm:text-3xl font-bold font-yrdly-display text-white tracking-tight">
              {isSignUp ? "Create an account" : "Log in to Yrdly"}
            </h2>
            <p className="text-xs sm:text-sm text-white/50">
              {isSignUp
                ? "Connect with your neighbours and community"
                : "Welcome back! Enter your details to continue"}
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold leading-snug">
              {error}
            </div>
          )}

          <form onSubmit={handleAuth} className="space-y-3.5">
            {isSignUp && (
              <>
                {/* Full Name */}
                <div className="flex items-center gap-3 px-4 h-13 rounded-xl bg-[#1c1f26] border border-white/10 focus-within:border-[#82DB7E] transition-all">
                  <User className="w-4 h-4 text-white/40 flex-shrink-0" />
                  <input
                    type="text"
                    placeholder="Full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-transparent outline-none text-sm text-white placeholder:text-white/30 font-yrdly-body"
                  />
                </div>

                {/* Username */}
                <div className="flex items-center gap-3 px-4 h-13 rounded-xl bg-[#1c1f26] border border-white/10 focus-within:border-[#82DB7E] transition-all">
                  <AtSign className="w-4 h-4 text-white/40 flex-shrink-0" />
                  <input
                    type="text"
                    placeholder="Username (e.g. johndoe)"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-transparent outline-none text-sm text-white placeholder:text-white/30 font-yrdly-body"
                  />
                </div>
              </>
            )}

            {/* Email */}
            <div className="flex items-center gap-3 px-4 h-13 rounded-xl bg-[#1c1f26] border border-white/10 focus-within:border-[#82DB7E] transition-all">
              <Mail className="w-4 h-4 text-white/40 flex-shrink-0" />
              <input
                type="email"
                placeholder="Mobile number, username or email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent outline-none text-sm text-white placeholder:text-white/30 font-yrdly-body"
              />
            </div>

            {/* Password */}
            <div className="flex items-center gap-3 px-4 h-13 rounded-xl bg-[#1c1f26] border border-white/10 focus-within:border-[#82DB7E] transition-all">
              <Lock className="w-4 h-4 text-white/40 flex-shrink-0" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-transparent outline-none text-sm text-white placeholder:text-white/30 font-yrdly-body"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-white/40 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {isSignUp && <PasswordStrengthIndicator value={password} />}

            {/* Primary Action Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 rounded-xl bg-[#82DB7E] text-black font-extrabold text-sm hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center shadow-lg shadow-[#82DB7E]/10"
              >
                {loading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-black" />
                ) : isSignUp ? (
                  "Create Account"
                ) : (
                  "Log in"
                )}
              </button>
            </div>
          </form>

          {/* Forgotten Password Link */}
          {!isSignUp && (
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => router.push("/forgot-password")}
                className="text-xs text-white/60 hover:text-white transition-colors font-medium"
              >
                Forgotten password?
              </button>
            </div>
          )}

          {/* Divider */}
          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-white/10" />
            <span className="flex-shrink mx-4 text-[11px] font-bold text-white/30 uppercase tracking-wider">
              OR
            </span>
            <div className="flex-grow border-t border-white/10" />
          </div>

          {/* Social Google Login Button */}
          <button
            type="button"
            onClick={handleGoogle}
            className="w-full h-12 rounded-xl bg-[#1c1f26] border border-white/10 text-white font-bold text-sm flex items-center justify-center gap-3 hover:bg-white/10 transition-all active:scale-[0.99]"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="#EA4335"
                d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.2 9 5 12 5z"
              />
              <path
                fill="#4285F4"
                d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
              />
              <path
                fill="#FBBC05"
                d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9c-.2-.7-.4-1.5-.4-2.3z"
              />
              <path
                fill="#34A853"
                d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.2-6.4-5.2L1.9 16C3.7 19.7 7.5 22.3 12 23z"
              />
            </svg>
            <span>Log in with Google</span>
          </button>

          {/* Mode Switch Outline Button */}
          <button
            type="button"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError("");
            }}
            className="w-full h-12 rounded-xl border border-white/20 text-white font-bold text-sm hover:bg-white/5 transition-all active:scale-[0.99]"
          >
            {isSignUp ? "Log in with existing account" : "Create new account"}
          </button>
        </div>

        {/* Footer Meta Style */}
        <div className="pt-6 text-center text-[11px] font-bold tracking-widest text-white/20 uppercase font-mono">
          YRDLY
        </div>
        </div>
      </div>
    </div>
  );
}
