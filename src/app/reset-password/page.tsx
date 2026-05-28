'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';

// Design tokens
const colors = {
  background: 'var(--c-bg)',
  blob: '#A154F2',
  overlay: 'rgba(255, 255, 255, 0.05)',
  border: '#388E3C',
  primary: '#388E3C',
  text: 'var(--c-text)',
  textFaded: 'var(--c-text-muted)',
};

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== 'PASSWORD_RECOVERY') {
        // If they just opened this without a token, redirect
        if (!session) {
          router.replace('/login');
        }
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(updateError.message);
      } else {
        setSuccess(true);
        setTimeout(() => {
          router.push('/login');
        }, 3000);
      }
    } catch (err) {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full h-12 sm:h-14 pl-4 pr-11 sm:pl-5 sm:pr-12 rounded-full font-sans font-light text-sm text-[var(--c-text)] placeholder:text-[var(--c-text-muted)] bg-transparent border-0 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 transition';
  const borderStyle = { border: '0.5px solid #388E3C' };
  const pillRound = 'rounded-full';

  return (
    <div
      className="min-h-[100dvh] relative flex flex-col items-center justify-center px-4 py-6"
      style={{ background: colors.background }}
    >
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute w-[10%] min-w-[40px] aspect-square rounded-full"
          style={{ background: colors.blob, opacity: 0.55, left: '5%', top: '10%' }}
        />
        <div
          className="absolute w-[8%] min-w-[32px] aspect-square rounded-full"
          style={{ background: colors.blob, opacity: 0.55, right: '5%', bottom: '10%' }}
        />
      </div>

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: colors.overlay,
          border: '1px solid var(--c-border)',
          backdropFilter: 'blur(1.8px)',
        }}
      />

      <div className="relative z-10 w-full max-w-[471px] flex flex-col items-center">
        <div className="text-center mb-8 w-full">
          <h1
            className="text-2xl text-[var(--c-text)] leading-tight px-1"
            style={{ fontFamily: '"Pacifico", cursive' }}
          >
            Set New Password
          </h1>
          <p className="font-sans font-light text-sm text-[var(--c-text-muted)] mt-2">
            Please enter your new password
          </p>
        </div>

        {success ? (
          <Alert className="mb-4 border-green-500/50 bg-green-500/10 text-green-200 w-full">
            <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-500 mr-2" />
            <AlertDescription>
              Your password has been successfully updated! Redirecting to login...
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {error && (
              <Alert className="mb-4 border-red-500/50 bg-red-500/10 text-red-200 w-full">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="w-full space-y-5">
              <div className={`relative ${pillRound}`} style={borderStyle}>
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="flex items-center justify-center w-full h-full text-[var(--c-text-muted)] hover:text-[var(--c-text)]"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  required
                  minLength={6}
                />
              </div>

              <div className={`relative ${pillRound}`} style={borderStyle}>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass}
                  required
                  minLength={6}
                />
              </div>

              <Button
                type="submit"
                className={`w-full h-11 ${pillRound} font-sans font-medium text-white hover:opacity-90`}
                style={{ background: colors.primary }}
                disabled={loading}
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Update Password
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
