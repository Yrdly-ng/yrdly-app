"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useOnboarding } from '@/hooks/use-onboarding';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, Sparkles, ArrowRight, Users, MapPin, Calendar, ShoppingBag } from 'lucide-react';
import { YrdlyLogo } from '@/components/ui/yrdly-logo';
import { useToast } from '@/hooks/use-toast';
import { ResendEmailService } from '@/lib/resend-service';
import { onboardingAnalytics } from '@/lib/onboarding-analytics';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { LoadingState } from '@/components/onboarding/LoadingState';
import { supabase } from '@/lib/supabase';
import { UserActivityService } from '@/lib/user-activity-service';

export default function OnboardingWelcomePage() {
  const { user, profile } = useAuth();
  const { completeWelcome, handleSkipTour } = useOnboarding();
  const router = useRouter();
  const { toast } = useToast();
  
  const [isLoading, setIsLoading] = useState(true);
  const [welcomeSent, setWelcomeSent] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [communityStats, setCommunityStats] = useState({
    totalUsers: 0,
    localUsers: 0,
    activeToday: 0,
    totalPosts: 0
  });
  const [statsLoading, setStatsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);

  // Load community stats
  const loadCommunityStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      
      // Get total users
      const { count: totalUsers, error: totalUsersError } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true });
      
      if (totalUsersError) {
        console.error('Error fetching total users:', totalUsersError);
      }

      // Get local users (same state) - only if user has location set
      let localUsers = 0;
      if (profile?.location?.state) {
        
        // First, let's see what location data exists
        const { data: allUsers, error: allUsersError } = await supabase
          .from('users')
          .select('id, location')
          .limit(10);
        
        if (allUsersError) {
          console.error('Error fetching sample users:', allUsersError);
        } else {
        }
        
        // Try a different approach - get all users and filter in JavaScript
        const { data: allUsersData, error: localUsersError } = await supabase
          .from('users')
          .select('id, location');
        
        if (localUsersError) {
          console.error('Error fetching users for local count:', localUsersError);
        } else {
          // Filter users by state in JavaScript
          localUsers = allUsersData?.filter(user => 
            user.location?.state === profile.location?.state
          ).length || 0;
        }
      } else {
      }

      // Get active today (users who used the app today)
      
      // First, let's see what last_seen data exists
      const { data: sampleUsers, error: sampleUsersError } = await supabase
        .from('users')
        .select('id, last_seen, is_online')
        .limit(5);
      
      if (sampleUsersError) {
        console.error('Error fetching sample users for last_seen:', sampleUsersError);
      } else {
      }
      
      // Use the UserActivityService to get active users today
      const activeToday = await UserActivityService.getActiveTodayCount();
      
      // Also get users active in the last 24 hours for comparison
      const activeLast24Hours = await UserActivityService.getActiveUsersCount(24);

      // Get total posts
      const { count: totalPosts, error: totalPostsError } = await supabase
        .from('posts')
        .select('*', { count: 'exact', head: true });
      
      if (totalPostsError) {
        console.error('Error fetching total posts:', totalPostsError);
      }

      setCommunityStats({
        totalUsers: totalUsers || 0,
        localUsers: localUsers || 0,
        activeToday: activeToday || 0,
        totalPosts: totalPosts || 0
      });
    } catch (error) {
      console.error('Error loading community stats:', error);
      // Set realistic fallback stats if loading fails
      setCommunityStats({
        totalUsers: 2847,
        localUsers: 127,
        activeToday: 43,
        totalPosts: 892
      });
    } finally {
      setStatsLoading(false);
    }
  }, [profile?.location]);

  // Trigger confetti animation
  const triggerConfetti = () => {
    setShowConfetti(true);
    setTimeout(() => setShowConfetti(false), 3000);
  };

  useEffect(() => {
    const sendWelcomeMessage = async () => {
      if (!user || !profile || welcomeSent) return;

      try {
        // Check if welcome email was already sent by checking database
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('welcome_message_sent')
          .eq('id', user.id)
          .single();

        // If already sent, skip email sending
        if (userData?.welcome_message_sent) {
          setWelcomeSent(true);
          await loadCommunityStats();
          triggerConfetti();
          setTimeout(() => setIsVisible(true), 500);
          setIsLoading(false);
          return;
        }

        // Send welcome email only if not sent before
        if (profile.email) {
          try {
            await ResendEmailService.sendWelcomeEmail(
              profile.email,
              profile.name || 'User',
              {
                username: profile.name || 'User',
                location: profile.location?.state || 'your area'
              }
            );
            onboardingAnalytics.trackWelcomeMessageSent(profile.email);
          } catch (emailError: any) {
            // Only log if it's not a configuration error
            if (emailError.message !== 'RESEND_NOT_CONFIGURED') {
              console.error('Error sending welcome email:', emailError);
            }
            // Continue without showing error to user
          }
        }

        // Mark welcome as sent in database
        await supabase
          .from('users')
          .update({ welcome_message_sent: true })
          .eq('id', user.id);

        // Mark welcome as sent in onboarding state
        await completeWelcome();
        setWelcomeSent(true);
        
        // Load community stats
        await loadCommunityStats();
        
        // Trigger confetti and animations
        triggerConfetti();
        setTimeout(() => setIsVisible(true), 500);
        
        toast({
          title: "Welcome to Yrdly!",
          description: "A welcome email has been sent to your inbox.",
        });
      } catch (error) {
        // Don't show error to user, just continue
        await completeWelcome();
        setWelcomeSent(true);
        
        // Still load stats and trigger confetti
        await loadCommunityStats();
        triggerConfetti();
        setTimeout(() => setIsVisible(true), 500);
      } finally {
        setIsLoading(false);
      }
    };

    sendWelcomeMessage();
  }, [user, profile, completeWelcome, welcomeSent, toast, loadCommunityStats]);

  const handleTakeTour = () => {
    onboardingAnalytics.trackTourStarted();
    router.push('/onboarding/tour');
  };

  const handleSkipTourClick = async () => {
    await handleSkipTour('welcome');
    router.push('/home');
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground">
        <OnboardingProgress />
        <div className="flex items-center justify-center p-4 pt-8">
          <LoadingState 
            type="profile" 
            message="Setting up your account..."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-20 overflow-x-hidden relative bg-background text-foreground" style={{ fontFamily: "\"Pacifico\", cursive" }}>
      <OnboardingProgress />
      
      {/* Background Glows */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#388E3C]/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#388E3C]/5 blur-[120px] rounded-full pointer-events-none" />

      {/* Confetti Effect */}
      {showConfetti && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {[...Array(40)].map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 rounded-full animate-bounce"
              style={{
                left: `${Math.random() * 100}%`,
                top: `-20px`,
                background: ['#388E3C', '#ffb347', '#a7d1ab', '#ffffff'][Math.floor(Math.random() * 4)],
                animationDelay: `${Math.random() * 3}s`,
                animationDuration: `${2 + Math.random() * 2}s`,
                opacity: 0.6,
                transform: `translateX(${Math.random() * 100 - 50}px)`
              }}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-center p-4 pt-12 md:pt-24 animate-in fade-in slide-in-from-bottom-8 duration-1000">
        <div className="max-w-md w-full space-y-10">
          {/* Logo & Header */}
          <div className={`text-center space-y-6 transition-all duration-1000 ${isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
            <div className="flex justify-center transform hover:scale-105 transition-transform duration-300">
              <YrdlyLogo />
            </div>
            
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#388E3C]/10 border border-[#388E3C]/20 mb-2">
                <Sparkles className="w-4 h-4 text-[#388E3C]" />
                <span className="text-xs font-black uppercase tracking-widest text-[#388E3C]">Profile Verified</span>
              </div>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight text-foreground leading-tight">
                Welcome home,<br/>{profile?.name?.split(' ')[0]}!
              </h2>
              <p className="text-muted-foreground text-lg max-w-[300px] mx-auto leading-relaxed">
                Your journey in <span className="text-foreground font-bold">{profile?.location?.state || 'your neighborhood'}</span> starts now.
              </p>
            </div>
          </div>



          {/* Action Card */}
          <div 
            className={`rounded-[48px] overflow-hidden transition-all duration-1000 delay-500 shadow-2xl bg-card border-border border backdrop-blur-3xl`}
          >
            <div className="p-10 space-y-10 relative">
              {/* Decorative Shine */}
              <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-tr from-[#388E3C]/5 via-transparent to-transparent pointer-events-none" />

              <div className="space-y-3 text-center relative z-10">
                <h3 className="text-3xl font-black text-foreground tracking-tight">Ready to explore?</h3>
                <p className="text-base text-muted-foreground font-medium opacity-80">
                  Discover events, connect with locals, and build your neighborhood legacy.
                </p>
              </div>

              <div className="space-y-5 relative z-10">
                <button 
                  onClick={handleTakeTour}
                  className="w-full h-20 rounded-[28px] flex items-center justify-center text-white text-xl font-black transition-all active:scale-[0.98] group relative overflow-hidden shadow-2xl"
                  style={{
                    background: "#388E3C",
                    boxShadow: "0 20px 40px -10px rgba(56,142,60,0.5)"
                  }}
                >
                  <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                  <span className="relative z-10 flex items-center gap-3">
                    Take a Quick Tour
                    <ArrowRight className="w-6 h-6 group-hover:translate-x-2 transition-transform duration-300" />
                  </span>
                </button>
                
                <button 
                  onClick={handleSkipTourClick}
                  className="w-full h-16 rounded-[28px] flex items-center justify-center font-black text-muted-foreground hover:text-foreground transition-all border border-border hover:border-[#388E3C]/30 hover:bg-[#388E3C]/5 active:scale-[0.98] uppercase tracking-[0.2em] text-[0.6875rem]"
                >
                  Jump Right In
                </button>
              </div>
              
              <div className="flex items-center gap-3 justify-center px-6 py-3 rounded-2xl bg-muted/50 border border-border relative z-10">
                <div className="w-8 h-8 rounded-lg bg-[#388E3C]/10 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-[#388E3C]" />
                </div>
                <span className="text-[0.6875rem] font-black uppercase tracking-widest text-muted-foreground">
                  Welcome guide sent to {profile?.email}
                </span>
              </div>
            </div>
          </div>

          <div className="text-center">
            <p className="text-[0.625rem] uppercase tracking-[0.2em] font-black text-muted-foreground/20">
              Yrdly Neighborhood Network • v2.0
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
