'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import Image from 'next/image';
import { Loader2, Mail, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { AUTH_CONSTANTS, ERROR_MESSAGES } from '@/lib/constants';
import { ErrorMessageFormatter } from '@/lib/error-messages';
import posthog from 'posthog-js';

// Design tokens from Figma
const colors = {
  background: 'var(--c-bg)',
  blob: '#A154F2',
  overlay: 'rgba(255, 255, 255, 0.05)',
  border: 'hsl(var(--primary))',
  inputBg: '#FFFFFF',
  primary: 'hsl(var(--primary))',
  text: 'var(--c-text)',
  textFaded: 'var(--c-text-muted)',
  link: '#1976D2',
  logoGreen: '#259907',
};

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [remainingTime, setRemainingTime] = useState(0);

  const { user, signIn, signUp, signInWithGoogle, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/home');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (lockoutUntil) {
      const interval = setInterval(() => {
        const now = Date.now();
        const timeLeft = Math.max(0, lockoutUntil - now);
        setRemainingTime(Math.ceil(timeLeft / 1000));
        if (timeLeft === 0) {
          setLockoutUntil(null);
          setLoginAttempts(0);
          clearInterval(interval);
        }
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [lockoutUntil]);

  if (authLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center" style={{ background: colors.background }}>
        <div className="text-center font-sans flex flex-col items-center gap-3">
          <Image
            src="/logo.png"
            alt="Yrdly"
            width={64}
            height={64}
            className="animate-pulse rounded-[14px]"
          />
          <p className="text-sm" style={{ color: colors.textFaded }}>Loading...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutUntil && Date.now() < lockoutUntil) return;
    setError('');
    setLoading(true);

    try {
      if (isSignUp) {
        if (!username) {
          setError('Username is required');
          setLoading(false);
          return;
        }
        const { user: newUser, error: err } = await signUp(email, password, name, username.toLowerCase());
        if (err) setError(err.message);
        else if (newUser) {
          posthog.identify(newUser.id, { email: newUser.email, name });
          posthog.capture('user_signed_up', { method: 'email' });
          setLoginAttempts(0);
          setLockoutUntil(null);
          if (newUser.email_confirmed_at) router.push('/home');
          else router.push(`/onboarding/verify-email?email=${encodeURIComponent(email)}`);
        }
      } else {
        const { user: signedUser, error: err } = await signIn(email, password);
        if (err) {
          const newAttempts = loginAttempts + 1;
          setLoginAttempts(newAttempts);
          if (newAttempts >= AUTH_CONSTANTS.MAX_LOGIN_ATTEMPTS) {
            setLockoutUntil(Date.now() + AUTH_CONSTANTS.LOGIN_LOCKOUT_DURATION);
            setError(`${ERROR_MESSAGES.TOO_MANY_ATTEMPTS} Please wait ${Math.ceil(AUTH_CONSTANTS.LOGIN_LOCKOUT_DURATION / 60000)} minutes.`);
          } else {
            const friendly = ErrorMessageFormatter.formatAuthError(err.message);
            const suggestion = ErrorMessageFormatter.getSuggestion(err.message);
            setError(suggestion ? `${friendly} ${suggestion}` : friendly);
          }
        } else if (signedUser) {
          posthog.identify(signedUser.id, { email: signedUser.email });
          posthog.capture('user_signed_in', { method: 'email' });
          setLoginAttempts(0);
          setLockoutUntil(null);
          router.push('/home');
        }
      }
    } catch {
      setError(ERROR_MESSAGES.GENERIC);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    posthog.capture('google_sign_in_initiated');
    try {
      const { error: err } = await signInWithGoogle();
      if (err) setError(err.message);
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full h-12 sm:h-14 pl-4 pr-11 sm:pl-5 sm:pr-12 rounded-full font-sans font-light text-sm text-foreground placeholder:text-muted-foreground bg-transparent border-0 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 transition';
  const borderStyle = { border: '0.5px solid #388E3C' };
  const pillRound = 'rounded-full';

  return (
    <div
      className="min-h-[100dvh] min-h-[100dvh] relative overflow-x-hidden overflow-y-auto flex flex-col items-center justify-center px-4 py-6 xs:py-8 sm:px-6 sm:py-10 md:px-8 md:py-12"
      style={{ background: colors.background }}
    >
      {/* Decorative blobs - scale down on small screens */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute w-[10%] min-w-[40px] max-w-[80px] aspect-square rounded-full sm:w-[6%] sm:min-w-0 sm:max-w-none"
          style={{ background: colors.blob, opacity: 0.55, left: '5.86%', top: '11.42%', transform: 'rotate(36deg)' }}
        />
        <div
          className="absolute w-[8%] min-w-[32px] max-w-[64px] aspect-square rounded-full sm:w-[5%] sm:min-w-0 sm:max-w-none"
          style={{ background: colors.blob, opacity: 0.55, left: '82%', top: '20%' }}
        />
        <div
          className="absolute w-[8%] min-w-[32px] max-w-[64px] aspect-square rounded-full sm:w-[5%] sm:min-w-0 sm:max-w-none"
          style={{ background: colors.blob, opacity: 0.55, left: '20%', top: '72%' }}
        />
        <div
          className="absolute w-[8%] min-w-[32px] max-w-[64px] aspect-square rounded-full sm:w-[5%] sm:min-w-0 sm:max-w-none"
          style={{ background: colors.blob, opacity: 0.55, right: '4.6%', bottom: '8.77%' }}
        />
      </div>

      {/* Glass overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: colors.overlay,
          border: '1px solid var(--c-border)',
          backdropFilter: 'blur(1.8px)',
        }}
      />

      {/* Content */}
      <div className="relative z-10 w-full max-w-[471px] min-w-0 flex flex-col items-center py-4 sm:py-6">
        {/* Header */}
        <div className="text-center mb-5 sm:mb-8 w-full">
          <h1
            className="text-xl sm:text-2xl leading-tight sm:leading-[42px] px-1"
            style={{ fontFamily: "var(--font-jersey25)", color: colors.text }}
          >
            See what&apos;s happening
          </h1>
          <p className="font-sans font-light italic text-xs mt-1" style={{ color: colors.textFaded }}>
            Sign in to your Yrdly account
          </p>
        </div>

        {/* Logo */}
        <div className="flex items-center justify-center mb-4 sm:mb-6">
          <Image
            src="/logo.png"
            alt="Yrdly"
            width={72}
            height={72}
            className="h-16 w-16 sm:h-20 sm:w-20 object-contain"
          />
        </div>

        {/* Sign in / Sign up toggle - selected tab has background card #1B2B3A */}
        <div
          className={`w-full h-12 sm:h-[52px] ${pillRound} p-1 flex relative mb-4 sm:mb-6`}
          style={{ border: '0.5px solid #388E3C' }}
        >
          <button
            type="button"
            onClick={() => setIsSignUp(false)}
            className={`flex-1 h-full rounded-full font-sans text-sm transition ${
              !isSignUp ? 'shadow-sm' : ''
            }`}
            style={{
              background: !isSignUp ? 'hsl(var(--primary))' : 'transparent',
              color: !isSignUp ? '#fff' : colors.textFaded,
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setIsSignUp(true)}
            className={`flex-1 h-full rounded-full font-sans text-sm transition ${
              isSignUp ? 'shadow-sm' : ''
            }`}
            style={{
              background: isSignUp ? 'hsl(var(--primary))' : 'transparent',
              color: isSignUp ? '#fff' : colors.textFaded,
            }}
          >
            Sign up
          </button>
        </div>

        {/* Alerts */}
        {lockoutUntil && Date.now() < lockoutUntil && (
          <Alert className="mb-3 sm:mb-4 border-red-500/50 bg-red-500/10 text-red-200 w-full text-sm">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <AlertDescription className="break-words">
              Too many attempts. Wait {remainingTime}s before trying again.
            </AlertDescription>
          </Alert>
        )}
        {error && !lockoutUntil && (
          <Alert className="mb-3 sm:mb-4 border-red-500/50 bg-red-500/10 text-red-200 w-full text-sm">
            <AlertDescription className="break-words">{error}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmit} className="w-full space-y-4 sm:space-y-5">
          {isSignUp && (
            <div className={`relative ${pillRound}`} style={borderStyle}>
              <Input
                type="text"
                placeholder="Enter your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                required={isSignUp}
              />
            </div>
          )}

          {isSignUp && (
            <div className="space-y-1">
              <label className="text-sm font-medium" style={{ color: colors.text }}>Username</label>
              <Input
                type="text"
                placeholder="Enter a unique username"
                value={username}
                onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                className={inputClass}
                required={isSignUp}
              />
            </div>
          )}

          <div className={`relative ${pillRound}`} style={borderStyle}>
            <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 flex items-center justify-center h-6 w-6 pointer-events-none">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          <div className={`relative ${pillRound}`} style={borderStyle}>
            <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 flex items-center justify-center h-6 w-6">
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="flex items-center justify-center w-full h-full text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              required
            />
          </div>

          {!isSignUp && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 cursor-pointer group min-w-0">
                <span
                  className="w-[15px] h-[15px] rounded-full border flex items-center justify-center flex-shrink-0"
                  style={{ borderColor: colors.border }}
                  aria-hidden
                >
                  {rememberMe && <span className="w-2 h-2 rounded-full bg-background" />}
                </span>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="sr-only"
                />
                <span className="font-sans font-light text-xs" style={{ color: colors.text }}>Remember me</span>
              </label>
              <Link
                href="/forgot-password"
                className="font-sans font-medium text-xs hover:underline"
                style={{ color: colors.link }}
              >
                Forgot Password?
              </Link>
            </div>
          )}

          <Button
            type="submit"
            className={`w-full h-10 sm:h-11 ${pillRound} font-sans font-medium text-sm text-primary-foreground hover:opacity-90 transition mt-1`}
            style={{ background: colors.primary }}
            disabled={loading || (!!lockoutUntil && Date.now() < lockoutUntil)}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {lockoutUntil && Date.now() < lockoutUntil
              ? `Locked (${remainingTime}s)`
              : isSignUp
                ? 'Create Account'
                : 'Sign in'}
          </Button>
        </form>

        {/* Divider - generous spacing, slightly reduced on small screens */}
        <div className="relative w-full flex items-center gap-2 sm:gap-3 mt-10 mb-10 sm:mt-16 sm:mb-14 min-w-0">
          <span className="flex-1 min-w-0 h-px bg-border" />
          <span className="font-sans font-light text-xs uppercase tracking-wide whitespace-nowrap flex-shrink-0" style={{ color: colors.textFaded }}>
            Or continue with
          </span>
          <span className="flex-1 min-w-0 h-px bg-border" />
        </div>

        {/* Google */}
        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className={`w-full h-10 sm:h-11 ${pillRound} font-sans font-medium text-sm border-primary hover:bg-accent`}
          style={{ color: colors.text }}
        >
          <svg className="mr-2 h-4 w-4 sm:h-[18px] sm:w-[18px] flex-shrink-0" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </Button>

        <p className="font-sans text-xs sm:text-sm mt-4 sm:mt-6 text-center px-2 break-words" style={{ color: colors.textFaded }}>
          {isSignUp ? (
            <>
              Already have an account?{' '}
              <button type="button" onClick={() => setIsSignUp(false)} className="text-[#1976D2] font-medium hover:underline">
                Sign in
              </button>
            </>
          ) : (
            <>
              Don&apos;t have an account?{' '}
              <button type="button" onClick={() => setIsSignUp(true)} className="text-[#1976D2] font-medium hover:underline">
                Sign up
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
