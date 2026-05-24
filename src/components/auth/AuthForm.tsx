"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Mail, Lock, User, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { YrdlyLogo } from '@/components/ui/yrdly-logo';
import { AUTH_CONSTANTS, ERROR_MESSAGES } from '@/lib/constants';
import { ErrorMessageFormatter } from '@/lib/error-messages';
import { PasswordStrength } from '@/components/ui/password-strength';
import Image from 'next/image';

interface AuthFormProps {
  mode: 'login' | 'signup';
  onToggleMode: () => void;
  onSuccess?: () => void;
}

export function AuthForm({ mode, onToggleMode, onSuccess }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginAttempts, setLoginAttempts] = useState(0);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [remainingTime, setRemainingTime] = useState(0);
  
  const { user, signIn, signUp, signInWithGoogle, loading: authLoading } = useAuth();
  const router = useRouter();

  // Redirect already logged-in users to home
  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/home');
    }
  }, [user, authLoading, router]);

  // Handle rate limiting timer
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

  // Show loading while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="h-16 w-16 mx-auto mb-4 animate-pulse">
            <YrdlyLogo />
          </div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check if user is locked out
    if (lockoutUntil && Date.now() < lockoutUntil) {
      return; // Don't proceed if locked out
    }
    
    setError('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const { user, error } = await signUp(email, password, name);
        if (error) {
          setError(error.message);
        } else if (user) {
          // Reset login attempts on successful signup
          setLoginAttempts(0);
          setLockoutUntil(null);
          
          // Check if user needs email confirmation
          if (user.email_confirmed_at) {
            onSuccess?.();
            router.push('/home');
          } else {
            // Redirect to onboarding email verification
            router.push(`/onboarding/verify-email?email=${encodeURIComponent(email)}`);
          }
        }
      } else {
        const { user, error } = await signIn(email, password);
        if (error) {
          // Increment login attempts on failed login
          const newAttempts = loginAttempts + 1;
          setLoginAttempts(newAttempts);
          
          // Lock out user after max attempts
          if (newAttempts >= AUTH_CONSTANTS.MAX_LOGIN_ATTEMPTS) {
            const lockoutTime = Date.now() + AUTH_CONSTANTS.LOGIN_LOCKOUT_DURATION;
            setLockoutUntil(lockoutTime);
            setError(`${ERROR_MESSAGES.TOO_MANY_ATTEMPTS} Please wait ${Math.ceil(AUTH_CONSTANTS.LOGIN_LOCKOUT_DURATION / 60000)} minutes.`);
          } else {
            const friendlyError = ErrorMessageFormatter.formatAuthError(error.message);
            const suggestion = ErrorMessageFormatter.getSuggestion(error.message);
            setError(suggestion ? `${friendlyError} ${suggestion}` : friendlyError);
          }
        } else if (user) {
          // Reset login attempts on successful login
          setLoginAttempts(0);
          setLockoutUntil(null);
          onSuccess?.();
          router.push('/home');
        }
      }
    } catch (err) {
      setError(ERROR_MESSAGES.GENERIC);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        setError(error.message);
      }
    } catch (err) {
      setError(ERROR_MESSAGES.GENERIC);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-0 shadow-lg">
        <CardHeader className="space-y-6 text-center pb-8">
          <div className="flex justify-center">
            <Image 
              src="/yrdly-logo.png" 
              alt="Yrdly Logo" 
              width={128} 
              height={128}
              className="w-32 h-32 object-cover object-left"
              priority
            />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-2xl font-bold text-center">
              {mode === 'signup' ? 'Create Account' : 'Welcome Back'}
            </CardTitle>
            <CardDescription className="text-center">
              {mode === 'signup' 
                ? 'Sign up to join your neighborhood community' 
                : 'Sign in to your Yrdly account'
              }
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {lockoutUntil && Date.now() < lockoutUntil && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Too many login attempts. Please wait {remainingTime} seconds before trying again.
              </AlertDescription>
            </Alert>
          )}
          
          {error && !lockoutUntil && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="name"
                    type="text"
                    placeholder="Enter your full name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-10"
                    required
                    aria-label="Full name"
                    aria-describedby="name-error"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                  aria-label="Email address"
                  aria-describedby="email-error"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={mode === 'signup' ? "Create a password" : "Enter your password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10"
                  required
                  aria-label="Password"
                  aria-describedby="password-error"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 h-4 w-4 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {mode === 'signup' && <PasswordStrength password={password} />}
            </div>

            <Button type="submit" className="w-full" disabled={loading || (!!lockoutUntil && Date.now() < lockoutUntil)}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {lockoutUntil && Date.now() < lockoutUntil 
                ? `Locked (${remainingTime}s)` 
                : mode === 'signup' ? 'Create Account' : 'Sign In'
              }
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with
              </span>
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="h-11 w-full max-w-sm"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </Button>
          </div>

          <div className="text-center text-sm">
            {mode === 'signup' ? 'Already have an account?' : "Don't have an account?"}{' '}
            <button
              type="button"
              onClick={onToggleMode}
              className="text-blue-600 hover:text-blue-500 font-medium"
            >
              {mode === 'signup' ? 'Sign in' : 'Sign up'}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
