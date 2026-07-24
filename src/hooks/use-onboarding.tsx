"use client";

import { useAuth } from './use-supabase-auth';
import { onboardingAnalytics } from '@/lib/onboarding-analytics';

export type OnboardingStep = 'signup' | 'email_verification' | 'profile_setup' | 'welcome' | 'tour' | 'completed';

export function useOnboarding() {
  const { user, profile, updateProfile } = useAuth();
  
  const getCurrentStep = (): OnboardingStep => {
    if (!user || !profile) return 'signup';
    
    // For OAuth users, consider email as verified if they have a provider
    const isEmailVerified = user.email_confirmed_at || 
      (user.app_metadata?.provider && user.app_metadata?.providers?.includes(user.app_metadata.provider));
    
    // Check if email is verified
    if (!isEmailVerified) return 'email_verification';
    
    // Check if profile is completed
    if (!profile.profile_completed) return 'profile_setup';
    
    // Check if welcome message has been sent
    if (!profile.welcome_message_sent) return 'welcome';
    
    // Check if tour is completed
    if (!profile.tour_completed) return 'tour';
    
    return 'completed';
  };

  const updateOnboardingStatus = async (status: OnboardingStep) => {
    if (!user) throw new Error('No user logged in');
    
    try {
      await updateProfile({ onboarding_status: status });
      onboardingAnalytics.track('onboarding_status_updated', { 
        status, 
        userId: user.id 
      });
    } catch (error: any) {
      console.error('Error updating onboarding status:', error);
      onboardingAnalytics.trackError('update_status', error.message, { status });
      throw error;
    }
  };

  const completeProfile = async () => {
    if (!user) throw new Error('No user logged in');
    
    try {
      await updateProfile({ 
        profile_completed: true,
        welcome_message_sent: true,   // mark as sent so we never route to /welcome
        onboarding_status: 'tour'
      });
      onboardingAnalytics.trackStepComplete('profile_setup', { userId: user.id });
    } catch (error: any) {
      console.error('Error completing profile:', error);
      onboardingAnalytics.trackError('profile_setup', error.message, { userId: user.id });
      throw error;
    }
  };

  const completeWelcome = async () => {
    if (!user) throw new Error('No user logged in');
    
    try {
      await updateProfile({ 
        welcome_message_sent: true,
        onboarding_status: 'tour'
      });
      onboardingAnalytics.trackStepComplete('welcome', { userId: user.id });
    } catch (error: any) {
      console.error('Error completing welcome:', error);
      onboardingAnalytics.trackError('welcome', error.message, { userId: user.id });
      throw error;
    }
  };

  const completeTour = async () => {
    if (!user) throw new Error('No user logged in');
    
    try {
      await updateProfile({ 
        tour_completed: true,
        onboarding_status: 'completed',
        onboarding_completed_at: new Date().toISOString()
      });
      onboardingAnalytics.trackStepComplete('tour', { userId: user.id });
      onboardingAnalytics.trackOnboardingComplete(0, { userId: user.id }); // Total time calculated by analytics
    } catch (error: any) {
      console.error('Error completing tour:', error);
      onboardingAnalytics.trackError('tour', error.message, { userId: user.id });
      throw error;
    }
  };

  const handleSkipTour = async (from: string = 'unknown') => {
    if (!user) throw new Error('No user logged in');
    
    try {
      await updateProfile({ 
        tour_completed: true,
        onboarding_status: 'completed',
        onboarding_completed_at: new Date().toISOString()
      });
      onboardingAnalytics.trackStepSkip('tour', `skipped_from_${from}`, { userId: user.id });
      onboardingAnalytics.trackOnboardingComplete(0, { userId: user.id, skipped: true });
    } catch (error: any) {
      console.error('Error skipping tour:', error);
      onboardingAnalytics.trackError('tour_skip', error.message, { userId: user.id });
      throw error;
    }
  };

  // Keep the old function for backward compatibility
  const skipTour = handleSkipTour;

  const resetOnboarding = async () => {
    if (!user) throw new Error('No user logged in');
    
    try {
      await updateProfile({
        onboarding_status: 'signup',
        profile_completed: false,
        onboarding_completed_at: undefined,
        tour_completed: false,
        welcome_message_sent: false
      });
    } catch (error: any) {
      console.error('Error resetting onboarding:', error);
      throw error;
    }
  };

  const currentStep = getCurrentStep();
  const isOnboardingComplete = currentStep === 'completed';

  return {
    currentStep,
    isOnboardingComplete,
    updateOnboardingStatus,
    completeProfile,
    completeWelcome,
    completeTour,
    skipTour,
    handleSkipTour,
    resetOnboarding,
    // Helper functions
    isEmailVerified: !!user?.email_confirmed_at || 
      (user?.app_metadata?.provider && user?.app_metadata?.providers?.includes(user.app_metadata.provider)),
    isProfileCompleted: !!profile?.profile_completed,
    isWelcomeSent: !!profile?.welcome_message_sent,
    isTourCompleted: !!profile?.tour_completed,
  };
}
