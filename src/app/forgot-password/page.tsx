'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Mail } from 'lucide-react';
import Link from 'next/link';

// Design tokens
const colors = {
  background: 'var(--c-bg)',
  blob: '#A154F2',
  overlay: 'rgba(255, 255, 255, 0.05)',
  border: 'hsl(var(--primary))',
  primary: 'hsl(var(--primary))',
  text: 'var(--c-text)',
  textFaded: 'var(--c-text-muted)',
  link: '#1976D2',
};

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl}/reset-password`,
      });

      if (resetError) {
        setError(resetError.message);
      } else {
        setSuccess(true);
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
            style={{ fontFamily: "var(--font-jersey25)" }}
          >
            Reset Password
          </h1>
          <p className="font-sans font-light text-sm text-[var(--c-text-muted)] mt-2">
            Enter your email to receive a password reset link
          </p>
        </div>

        {error && (
          <Alert className="mb-4 border-red-500/50 bg-red-500/10 text-red-200 w-full">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success ? (
          <div className="w-full text-center space-y-4">
            <Alert className="mb-4 border-green-500/50 bg-green-500/10 text-green-200 w-full">
              <AlertDescription>Check your email for a reset link.</AlertDescription>
            </Alert>
            <Button
              onClick={() => router.push('/login')}
              variant="outline"
              className="w-full h-11 rounded-full font-sans text-[var(--c-text)] border-primary hover:bg-accent"
            >
              Back to Sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="w-full space-y-5">
            <div className={`relative ${pillRound}`} style={borderStyle}>
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <Mail className="h-5 w-5 text-[#BBBBBB]" />
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

            <Button
              type="submit"
              className={`w-full h-11 ${pillRound} font-sans font-medium text-primary-foreground hover:opacity-90`}
              style={{ background: colors.primary }}
              disabled={loading}
            >
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Reset Link
            </Button>

            <div className="text-center mt-6">
              <Link
                href="/login"
                className="font-sans text-sm hover:underline"
                style={{ color: colors.link }}
              >
                Back to Sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
