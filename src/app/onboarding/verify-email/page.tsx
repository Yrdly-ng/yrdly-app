"use client";

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useOnboarding } from '@/hooks/use-onboarding';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Mail, RefreshCw, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { YrdlyLogo } from '@/components/ui/yrdly-logo';
import { useToast } from '@/hooks/use-toast';
import { ResendEmailService } from '@/lib/resend-service';
// Removed Firebase import - using Supabase auth
import { onboardingAnalytics } from '@/lib/onboarding-analytics';
import { supabase } from '@/lib/supabase';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { LoadingState } from '@/components/onboarding/LoadingState';

function VerifyEmailContent() {
  const { user, profile, loading } = useAuth();
  const { updateOnboardingStatus, isEmailVerified } = useOnboarding();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  
  const [isResending, setIsResending] = useState(false);
  const [lastSentTime, setLastSentTime] = useState<number | null>(null);
  const [cooldownTime, setCooldownTime] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [timeSinceSent, setTimeSinceSent] = useState(0);
  const [currentTip, setCurrentTip] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [checkRetryCount, setCheckRetryCount] = useState(0);
  const [lastCheckTime, setLastCheckTime] = useState<number | null>(null);

  const email = searchParams.get('email') || user?.email || '';

  const tips = [
    "Check your spam folder if you don't see the email",
    "Wait 2-3 minutes for the email to arrive",
    "Make sure you entered the correct email address",
    "Try refreshing your email inbox",
    "Contact support if you're still having trouble"
  ];

  // Redirect if user is not authenticated using auth state listener
  useEffect(() => {
    if (loading) return; // Don't redirect while loading

    if (!user) {
      // Listen for auth state changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (event === 'SIGNED_IN' && session?.user) {
            // User is now authenticated, component will re-render
          } else if (event === 'SIGNED_OUT' || (!session && event !== 'INITIAL_SESSION')) {
            router.push('/login');
          }
        }
      );

      // If still no user after a reasonable time, redirect
      const fallbackTimer = setTimeout(() => {
        if (!user) {
          router.push('/login');
        }
      }, 5000);

      return () => {
        subscription.unsubscribe();
        clearTimeout(fallbackTimer);
      };
    }
  }, [user, loading, router]);

  // Check if user is verified and redirect
  useEffect(() => {
    if (isEmailVerified) {
      // Add a small delay to show the success state
      const timer = setTimeout(() => {
        updateOnboardingStatus('profile_setup');
        onboardingAnalytics.trackStepComplete('email_verification', { 
          userId: user?.id,
          method: 'automatic'
        });
        router.push('/onboarding/profile');
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [isEmailVerified, updateOnboardingStatus, router, user?.id]);

  // Cooldown timer and time since sent
  useEffect(() => {
    if (lastSentTime) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastSentTime) / 1000);
        const remaining = Math.max(0, 60 - elapsed);
        setCooldownTime(remaining);
        setTimeSinceSent(elapsed);
        
        if (remaining === 0) {
          clearInterval(interval);
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [lastSentTime]);

  // Tip rotation
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % tips.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [tips.length]);

  const handleCheckVerification = useCallback(async () => {
    if (!user || loading) return;
    
    // Check retry limits
    const now = Date.now();
    const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
    
    if (lastCheckTime && (now - lastCheckTime) < oneHour) {
      if (checkRetryCount >= 5) {
        setError('Too many verification checks. Please wait an hour before trying again.');
        return;
      }
    } else {
      // Reset counter if more than an hour has passed
      setCheckRetryCount(0);
    }
    
    setIsChecking(true);
    setLastCheckTime(now);
    setCheckRetryCount(prev => prev + 1);
    
    try {
      // Check verification status - refresh user data first
      const { data: { user: refreshedUser }, error } = await supabase.auth.getUser();
      
      if (error) {
        throw error;
      }
      
      if (refreshedUser?.email_confirmed_at) {
        await updateOnboardingStatus('profile_setup');
        toast({
          title: "Email Verified!",
          description: "Your email has been successfully verified.",
        });
        router.push('/onboarding/profile');
      } else {
        toast({
          title: "Not Verified Yet",
          description: "Your email is not verified yet. Please check your inbox and click the verification link.",
        });
      }
    } catch (error) {
      console.error('Error checking verification:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to check verification status. Please try again.",
      });
    } finally {
      setIsChecking(false);
    }
  }, [user, loading, updateOnboardingStatus, toast, router, checkRetryCount, lastCheckTime]);

  // Visibility detection for auto-check (with debounce)
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isChecking) {
        setIsVisible(true);
        // Auto-check verification when tab becomes visible (debounced)
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          if (user && !isEmailVerified && checkRetryCount < 5) {
            handleCheckVerification();
          }
        }, 2000); // 2 second debounce
      } else {
        setIsVisible(false);
        clearTimeout(timeoutId);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearTimeout(timeoutId);
    };
  }, [user, isEmailVerified, isChecking, checkRetryCount, lastCheckTime, handleCheckVerification]);

  // Page load animation
  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleResendVerification = async () => {
    if (!user || cooldownTime > 0 || loading) return;

    setIsResending(true);
    setError(null);
    
    try {
      // Try to send verification email via Resend
      try {
        // Create verification link with user ID as token
        const verificationLink = ResendEmailService.generateManualVerificationLink(user.id, email);
        
        // Send verification email via Resend
        await ResendEmailService.sendVerificationEmail(email, verificationLink, user.user_metadata?.name || user.email?.split('@')[0]);
        
        onboardingAnalytics.trackEmailVerificationSent(email);
      } catch (error: unknown) {
        // Handle different types of Resend errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage === 'RESEND_NOT_CONFIGURED') {
          setError('Email service is not configured. Please contact support or use the manual verification link below.');
        } else if (errorMessage === 'RESEND_SEND_FAILED') {
          setError('Email service failed to send. Please try again or contact support.');
        } else {
          setError('Failed to send verification email. Please try again or contact support.');
        }
        
        onboardingAnalytics.trackEmailVerificationSent(email);
      }
      
      setLastSentTime(Date.now());
      setCooldownTime(60);
      setRetryCount(0); // Reset retry count on success
      
      toast({
        title: "Verification Email Sent",
        description: "Please check your inbox and spam folder for the verification link.",
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Failed to send verification email. Please try again.";
      setError(errorMessage);
      setRetryCount(prev => prev + 1);
      
      onboardingAnalytics.trackError('email_verification', errorMessage, { 
        userId: user.id,
        action: 'resend',
        retryCount: retryCount + 1
      });
      
      toast({
        variant: "destructive",
        title: "Error Sending Email",
        description: errorMessage,
      });
    } finally {
      setIsResending(false);
    }
  };

  const handleRetry = () => {
    setError(null);
    setRetryCount(0);
    handleResendVerification();
  };

  const handleContactSupport = () => {
    // Open support contact (could be email, chat, etc.)
    window.open('mailto:support@yrdly.com?subject=Email Verification Issue', '_blank');
  };

  const handleOpenEmailApp = () => {
    // Try to open email app
    const emailAppUrl = `mailto:${email}`;
    window.open(emailAppUrl, '_self');
  };

  const formatTimeSinceSent = (seconds: number) => {
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };


  const handleBackToSignup = () => {
    router.push('/login');
  };

  // Show loading while checking authentication
  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <OnboardingProgress />
        <div className="flex items-center justify-center p-4 pt-8">
          <LoadingState 
            type="email" 
            message="Verifying your account setup..."
          />
        </div>
      </div>
    );
  }

  // Show waiting state if no user (but not loading)
  if (!loading && !user) {
    return (
      <div className="min-h-[100dvh] bg-background">
        <OnboardingProgress />
        <div className="flex items-center justify-center p-4 pt-8">
          <LoadingState 
            type="general" 
            message="Setting up your account..."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-20 overflow-x-hidden" style={{ background: "var(--c-bg)", color: "var(--c-text)", fontFamily: "Inter, sans-serif" }}>
      <OnboardingProgress />
      
      {/* Animated Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full blur-[150px] opacity-20" style={{ background: "radial-gradient(circle, #388E3C 0%, transparent 70%)" }} />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[150px] opacity-10" style={{ background: "radial-gradient(circle, #388E3C 0%, transparent 70%)" }} />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center p-4 pt-12 md:pt-20">
        <div className="max-w-md w-full space-y-8">
          
          {/* Logo & Header */}
          <div className="text-center space-y-6">
            <div className="flex justify-center transform hover:scale-105 transition-transform duration-500">
              <YrdlyLogo />
            </div>
            <div className="space-y-3">
              <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white leading-tight">
                Secure Your <span style={{ color: "#388E3C" }}>Account</span>
              </h2>
              <p className="text-muted-foreground text-lg font-medium">
                We&apos;ve sent a portal link to your inbox
              </p>
            </div>
          </div>

          <div 
            className={`transition-all duration-700 rounded-[40px] overflow-hidden backdrop-blur-xl ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`}
            style={{
              background: "rgba(30, 33, 38, 0.7)",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 40px 100px -20px rgba(0,0,0,0.6)"
            }}
          >
            <div className="p-8 md:p-10 space-y-8">
              <div className="text-center space-y-4">
                <div 
                  className="mx-auto w-24 h-24 rounded-[32px] flex items-center justify-center relative group"
                  style={{ background: "rgba(56,142,60,0.1)", border: "1px solid rgba(56,142,60,0.2)" }}
                >
                  <div className="absolute inset-0 bg-[#388E3C] blur-2xl opacity-20 group-hover:opacity-40 transition-opacity duration-500 rounded-full" />
                  <Mail className="w-10 h-10 text-[#388E3C] relative z-10 animate-bounce" style={{ animationDuration: '3s' }} />
                </div>
                
                <div className="space-y-2">
                  <div className="text-xl font-bold text-white px-4">
                    Verification Link Sent
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <span className="px-4 py-1.5 rounded-full bg-white/5 border border-border text-sm font-bold text-[#388E3C]">
                      {email}
                    </span>
                    {lastSentTime && timeSinceSent > 0 && (
                      <span className="text-[0.625rem] uppercase tracking-widest font-black text-muted-foreground/60 mt-1">
                        Dispatched {formatTimeSinceSent(timeSinceSent)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {error ? (
                  <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-red-200 font-medium leading-relaxed">{error}</p>
                  </div>
                ) : (
                  <div className="p-4 rounded-2xl bg-[#388E3C]/10 border border-[#388E3C]/20 flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#388E3C] shrink-0 mt-0.5" />
                    <p className="text-sm text-foreground font-medium leading-relaxed">
                      Tap the magic link in your email to instantly verify your residency.
                    </p>
                  </div>
                )}

                {/* Interactive Tips */}
                <div className="relative overflow-hidden rounded-[24px] bg-background/40 border border-border p-5">
                   <div className="absolute top-0 left-0 w-1 h-full bg-[#388E3C]" />
                   <div className="space-y-2">
                      <div className="text-[0.625rem] uppercase tracking-[0.2em] font-black text-[#388E3C]">Pro Tip</div>
                      <div className="text-sm font-bold text-white/90 leading-relaxed animate-in fade-in slide-in-from-right-2 duration-500" key={currentTip}>
                        {tips[currentTip]}
                      </div>
                   </div>
                </div>

                <div className="space-y-4">
                  <button 
                    onClick={handleCheckVerification}
                    disabled={isChecking}
                    className="w-full h-16 rounded-[22px] flex items-center justify-center text-white text-lg font-black transition-all active:scale-[0.98] disabled:opacity-50 relative group overflow-hidden"
                    style={{
                      background: "#388E3C",
                      boxShadow: "0 15px 30px -5px rgba(56,142,60,0.4)"
                    }}
                  >
                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                    <span className="relative z-10 flex items-center gap-3">
                      {isChecking ? (
                        <>
                          <RefreshCw className="w-6 h-6 animate-spin" />
                          Checking Status...
                        </>
                      ) : (
                        <>
                          I&apos;ve Verified My Email
                          <CheckCircle className="w-6 h-6" />
                        </>
                      )}
                    </span>
                  </button>

                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={handleOpenEmailApp}
                      className="h-14 rounded-[20px] flex items-center justify-center font-bold text-white bg-white/5 border border-border hover:bg-accent transition-all active:scale-95 text-sm gap-2"
                    >
                      <Mail className="w-4 h-4" />
                      Open Inbox
                    </button>

                    <button 
                      onClick={handleResendVerification}
                      disabled={isResending || cooldownTime > 0}
                      className="h-14 rounded-[20px] flex items-center justify-center font-bold text-muted-foreground bg-transparent border border-border hover:border-border transition-all active:scale-95 text-sm gap-2 disabled:opacity-50"
                    >
                      {isResending ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : cooldownTime > 0 ? (
                        <span>{cooldownTime}s</span>
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      Resend
                    </button>
                  </div>

                  <button 
                    onClick={handleBackToSignup}
                    className="w-full h-12 flex items-center justify-center font-bold text-muted-foreground/60 hover:text-muted-foreground transition-all text-sm gap-2 mt-4"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Return to Login
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Support Section */}
          <div className="flex flex-col items-center gap-4 py-4">
            <p className="text-[0.625rem] text-muted-foreground/40 font-black uppercase tracking-[0.3em]">
              Encrypted • Community Verified
            </p>
            <button 
              onClick={handleContactSupport}
              className="text-xs font-black text-[#388E3C] hover:underline underline-offset-4 tracking-widest uppercase"
            >
              Need assistance? Contact Support
            </button>
          </div>
        </div>
      </div>
    </div>

  );
}

export default function OnboardingVerifyEmailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
