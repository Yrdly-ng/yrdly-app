'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';

export default function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('Processing...');

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        setStatus('Handling OAuth callback...');
        
        // Check if Supabase client is properly initialized
        if (!supabase || !supabase.auth) {
          throw new Error('Supabase client not properly initialized');
        }
        
        // Debug environment variables
        
        // Check if we have URL fragments (OAuth response)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const searchParams = new URLSearchParams(window.location.search);
        
        
        // If we have an access token in the hash, exchange it for a session
        if (hashParams.get('access_token')) {
          setStatus('Exchanging tokens for session...');
          
          try {
            const { data, error } = await supabase.auth.setSession({
              access_token: hashParams.get('access_token')!,
              refresh_token: hashParams.get('refresh_token')!,
            });
            
            if (error) {
              console.error('Error setting session:', error);
              setError(`Session error: ${error.message}`);
              setTimeout(() => {
                router.push('/login?error=' + encodeURIComponent(error.message));
              }, 2000);
              return;
            }
            
            if (data.session) {
              setStatus('Session established, redirecting...');
              
              // For OAuth users, we need to ensure they have a proper profile
              // The AuthProvider will handle creating the profile if it doesn't exist
              // Wait a moment for the auth state to update, then redirect
              setTimeout(() => {
                window.location.href = '/home';
              }, 1000);
              return;
            } else {
              setError('No session data received');
              setTimeout(() => {
                router.push('/login?error=No session data received');
              }, 2000);
              return;
            }
          } catch (sessionError) {
            console.error('Session error:', sessionError);
            setError(`Session error: ${sessionError instanceof Error ? sessionError.message : 'Unknown error'}`);
            setTimeout(() => {
              router.push('/login?error=Session error');
            }, 2000);
            return;
          }
        }
        
        // Check if we have a session already (user might be already authenticated)
        setStatus('Checking existing session...');
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Auth callback error:', error);
          setError(`Auth error: ${error.message}`);
          setTimeout(() => {
            router.push('/login?error=' + encodeURIComponent(error.message));
          }, 2000);
          return;
        }

        if (data.session) {
          setStatus('User already authenticated, redirecting...');
          // Redirect to home immediately with cache busting
          setTimeout(() => {
            window.location.href = '/home';
          }, 1000);
        } else {
          setStatus('No session found, redirecting to login...');
          setTimeout(() => {
            window.location.href = '/login';
          }, 1000);
        }
      } catch (error) {
        console.error('Unexpected error:', error);
        setError(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setTimeout(() => {
          router.push('/login?error=An unexpected error occurred');
        }, 2000);
      }
    };

    // Handle the callback immediately
    handleAuthCallback();
  }, [router]);

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10 overflow-x-hidden"
      style={{ background: "var(--c-bg)", color: "var(--c-text)", fontFamily: "var(--font-work-sans)" }}
    >
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-[-15%] right-[-15%] w-[55%] h-[55%] rounded-full blur-[160px] opacity-15"
          style={{ background: "radial-gradient(circle, #388E3C 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-[-15%] left-[-15%] w-[55%] h-[55%] rounded-full blur-[160px] opacity-10"
          style={{ background: "radial-gradient(circle, #388E3C 0%, transparent 70%)" }}
        />
      </div>

      <div className="relative z-10 w-full max-w-[420px] flex flex-col items-center gap-8">
        <div className="text-center font-sans flex flex-col items-center gap-4">
          <img
            src="/yrdly-logo.png"
            alt="Yrdly"
            width={72}
            height={72}
            className="animate-pulse rounded-[16px] shadow-2xl"
          />
          <h1 className="text-xl font-bold tracking-tight mt-2" style={{ color: "var(--c-text)" }}>
            {status}
          </h1>
        </div>
        
        {error && (
          <div className="w-full rounded-[16px] p-4 text-center" style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)" }}>
            <p className="text-sm font-medium" style={{ color: "#ef4444" }}>{error}</p>
          </div>
        )}
        
        <p className="text-sm font-medium" style={{ color: "var(--c-text-muted)" }}>
          If this takes too long, <a href="/home" className="underline transition-opacity hover:opacity-80" style={{ color: "hsl(var(--primary))" }}>click here</a>
        </p>
      </div>
    </div>
  );
}
