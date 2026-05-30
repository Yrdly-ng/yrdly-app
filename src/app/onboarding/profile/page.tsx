"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useOnboarding } from '@/hooks/use-onboarding';
import { useDebounce } from '@/hooks/use-debounce';
import { useLocationData } from '@/hooks/use-location-data';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ArrowLeft, MapPin, User, HelpCircle, Lightbulb, CheckCircle2, Sparkles } from 'lucide-react';
import { YrdlyLogo } from '@/components/ui/yrdly-logo';
import { useToast } from '@/hooks/use-toast';
import { onboardingAnalytics } from '@/lib/onboarding-analytics';
import { supabase } from '@/lib/supabase';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { LoadingState } from '@/components/onboarding/LoadingState';
import { GpsLocationStep } from '@/components/onboarding/GpsLocationStep';

const profileFormSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be less than 20 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  fullName: z.string()
    .min(2, 'Full name must be at least 2 characters')
    .max(50, 'Full name must be less than 50 characters'),
  location: z.object({
    state: z.string().min(1, 'Please select a state'),
    lga: z.string().min(1, 'Please select an LGA'),
    ward: z.string().optional(),
    address: z.string().optional(),
  }),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

export default function OnboardingProfilePage() {
  const { user, profile, updateProfile } = useAuth();
  const { completeProfile } = useOnboarding();
  const router = useRouter();
  const { toast } = useToast();
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showManualLocation, setShowManualLocation] = useState(false);
  const [gpsLocation, setGpsLocation] = useState<{ lat?: number; lng?: number } | null>(null);

  // Use lazy loading hook for location data
  const { states, lgas, wards, isLoading: locationLoading, error: locationError, loadLgas, loadWards } = useLocationData();

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      username: '',
      fullName: '',
      location: {
        state: '',
        lga: '',
        ward: '',
        address: '',
      },
    },
  });

  // Sync form values once the async profile data arrives
  useEffect(() => {
    if (!profile) return;
    form.reset({
      username: profile.username || '',
      fullName: profile.name || '',
      location: {
        state: profile.location?.state || '',
        lga: profile.location?.lga || '',
        ward: profile.location?.ward || '',
        address: '',
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  // Get the current username value and debounce it
  const usernameValue = form.watch('username');
  const debouncedUsername = useDebounce(usernameValue, 500);
  const fullNameValue = form.watch('fullName');

  // Generate username suggestions based on full name
  const generateUsernameSuggestions = (fullName: string, currentUsername: string) => {
    if (!fullName || fullName.length < 2) return [];
    
    const suggestions: string[] = [];
    const nameParts = fullName.toLowerCase().split(' ').filter(part => part.length > 0);
    
    if (nameParts.length >= 2) {
      // First name + last name
      suggestions.push(`${nameParts[0]}${nameParts[nameParts.length - 1]}`);
      // First name + last initial
      suggestions.push(`${nameParts[0]}${nameParts[nameParts.length - 1][0]}`);
      // First initial + last name
      suggestions.push(`${nameParts[0][0]}${nameParts[nameParts.length - 1]}`);
    }
    
    if (nameParts.length >= 1) {
      // Just first name
      suggestions.push(nameParts[0]);
      // First name + numbers
      suggestions.push(`${nameParts[0]}123`);
      suggestions.push(`${nameParts[0]}2024`);
    }
    
    // Add some random suggestions
    suggestions.push(`${nameParts[0] || 'user'}_${Math.floor(Math.random() * 1000)}`);
    
    // Filter out current username and duplicates
    return suggestions
      .filter(suggestion => suggestion !== currentUsername && suggestion.length >= 3)
      .slice(0, 5);
  };

  // Handle state selection
  const handleStateChange = (state: string) => {
    form.setValue('location.state', state);
    form.setValue('location.lga', '');
    form.setValue('location.ward', '');
    loadLgas(state);
  };

  // Handle LGA selection
  const handleLgaChange = (lga: string) => {
    form.setValue('location.lga', lga);
    form.setValue('location.ward', '');
    loadWards(form.getValues('location.state'), lga);
  };

  // Check username availability with better error handling
  const checkUsernameAvailability = useCallback(async (username: string) => {
    if (username.length < 3) {
      setUsernameAvailable(null);
      setUsernameError(null);
      return;
    }

    setCheckingUsername(true);
    setUsernameError(null);
    
    try {
      // Check if username is available by querying the database
      // Exclude the current user's own record so re-visiting doesn't flag their own username as taken
      let query = supabase
        .from('users')
        .select('username')
        .eq('username', username)
        .limit(1);
      
      if (user?.id) {
        query = query.neq('id', user.id);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error checking username:', error);
        setUsernameAvailable(null);
        setUsernameError('Failed to check username availability');
      } else if (data && data.length > 0) {
        // Username found on another user, not available
        setUsernameAvailable(false);
        setUsernameError(null);
      } else {
        // No rows found, username is available
        setUsernameAvailable(true);
        setUsernameError(null);
      }
    } catch (error) {
      console.error('Error checking username:', error);
      setUsernameAvailable(null);
      setUsernameError('Network error. Please try again.');
    } finally {
      setCheckingUsername(false);
    }
  }, [user?.id]);

  // Debounced username checking effect
  useEffect(() => {
    if (debouncedUsername && debouncedUsername.length >= 3) {
      checkUsernameAvailability(debouncedUsername);
    } else {
      setUsernameAvailable(null);
      setUsernameError(null);
    }
  }, [debouncedUsername, checkUsernameAvailability]);

  // Generate username suggestions when full name changes
  useEffect(() => {
    if (fullNameValue && fullNameValue.length >= 2) {
      const suggestions = generateUsernameSuggestions(fullNameValue, usernameValue);
      setUsernameSuggestions(suggestions);
    } else {
      setUsernameSuggestions([]);
    }
  }, [fullNameValue, usernameValue]);

  const onSubmit = async (data: ProfileFormValues) => {
    if (usernameAvailable === false) {
      toast({
        variant: "destructive",
        title: "Username Not Available",
        description: "Please choose a different username.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Track profile setup start
      onboardingAnalytics.trackProfileSetupStarted(!!data.location.state);

      // Update user profile
      const updates: any = {
        name: data.fullName,
        username: data.username,
        location: data.location,
      };
      
      if (gpsLocation) {
        updates.current_location = gpsLocation;
      }

      await updateProfile(updates);

      // Complete profile setup
      await completeProfile();

      // Track profile setup completion
      onboardingAnalytics.trackProfileSetupCompleted({
        hasUsername: !!data.username,
        hasLocation: !!data.location.state,
        hasAvatar: false,
        locationCompleteness: calculateLocationCompleteness(data.location),
      });

      toast({
        title: "Profile Complete!",
        description: "Your profile has been successfully set up.",
      });

      router.push('/onboarding/welcome');
    } catch (error: any) {
      console.error('Error updating profile:', error);
      onboardingAnalytics.trackError('profile_setup', error.message, {  
        userId: user?.id,
        hasLocation: !!data.location.state
      });
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update profile. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const calculateLocationCompleteness = (location: any) => {
    let completeness = 0;
    if (location.state) completeness += 25;
    if (location.lga) completeness += 25;
    if (location.ward) completeness += 25;
    if (location.address) completeness += 25;
    return completeness;
  };

  const handleBackToVerification = () => {
    router.push('/onboarding/verify-email');
  };

  const handleUseSuggestion = (suggestion: string) => {
    form.setValue('username', suggestion);
    setShowSuggestions(false);
  };

  // Show loading state while location data is being loaded
  if (locationLoading && states.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-background text-foreground" style={{ fontFamily: "Inter, sans-serif" }}>
        <OnboardingProgress />
        <div className="flex items-center justify-center p-4 pt-8">
          <LoadingState 
            type="location" 
            message="Loading location data..."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-20 overflow-x-hidden bg-background text-foreground" style={{ fontFamily: "Inter, sans-serif" }}>
      <OnboardingProgress />
      
      {/* Animated Background Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full blur-[150px] opacity-20 transition-all duration-1000" style={{ background: "radial-gradient(circle, #388E3C 0%, transparent 70%)" }} />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full blur-[150px] opacity-10 transition-all duration-1000" style={{ background: "radial-gradient(circle, #388E3C 0%, transparent 70%)" }} />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center p-4 pt-12 md:pt-20">
        <div className="max-w-lg w-full space-y-12">
          
          {/* Logo & Header */}
          <div className="text-center space-y-6">
            <div className="flex justify-center transform hover:scale-105 transition-transform duration-500">
              <YrdlyLogo />
            </div>
            <div className="space-y-3">
              <h2 className="text-4xl md:text-5xl font-black tracking-tight text-foreground leading-tight">
                Refine Your <span style={{ color: "#388E3C" }}>Presence</span>
              </h2>
              <p className="text-muted-foreground text-lg font-medium">
                Your neighborhood identity starts here
              </p>
            </div>
          </div>
          <div 
            className="rounded-[48px] overflow-hidden backdrop-blur-2xl bg-card/80 border-border border shadow-2xl"
          >
            <div className="p-10 md:p-12 space-y-12">
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-12">
                {/* Form Fields */}
                <div className="space-y-10">
                  {/* Name Input */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <Label className="text-[0.6875rem] uppercase tracking-[0.25em] font-black text-muted-foreground">Full Legal Name</Label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="w-4 h-4 text-muted-foreground/40 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent className="bg-card border-border text-white font-bold p-4 rounded-2xl max-w-[200px] shadow-2xl backdrop-blur-xl">
                            Used for identity verification and official neighborhood transactions.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="relative group">
                      <div className="absolute inset-0 bg-[#388E3C] rounded-[24px] opacity-0 group-focus-within:opacity-5 blur-xl transition-opacity" />
                      <Input
                        placeholder="e.g. Tolu Oyelowo"
                        className="h-16 rounded-[24px] bg-muted/50 border-border focus:border-[#388E3C]/50 transition-all text-xl font-bold px-8"
                        autoComplete="name"
                        {...form.register('fullName')}
                      />
                    </div>
                    {form.formState.errors.fullName && (
                      <p className="text-sm text-red-400 font-bold px-2 animate-in fade-in slide-in-from-top-1">
                        {form.formState.errors.fullName.message}
                      </p>
                    )}
                  </div>

                  {/* Username Input */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <Label className="text-[0.6875rem] uppercase tracking-[0.25em] font-black text-muted-foreground">Neighborhood Handle</Label>
                    </div>
                    
                    <div className="relative group">
                      <div className="absolute inset-0 bg-[#388E3C] rounded-[24px] opacity-0 group-focus-within:opacity-5 blur-xl transition-opacity pointer-events-none" />
                      <div className="absolute left-8 top-1/2 -translate-y-1/2 text-[#388E3C] font-black text-2xl pointer-events-none">@</div>
                      <Input
                        placeholder="username"
                        className="h-16 pl-16 pr-16 rounded-[24px] bg-muted/50 border-border focus:border-[#388E3C]/50 transition-all text-xl font-bold"
                        {...form.register('username')}
                        onFocus={() => setShowSuggestions(usernameSuggestions.length > 0)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        maxLength={20}
                      />
                      <div className="absolute right-8 top-1/2 -translate-y-1/2 flex items-center gap-3 pointer-events-none">
                         {checkingUsername && <div className="w-6 h-6 border-3 border-[#388E3C] border-t-transparent rounded-full animate-spin" />}
                         {!checkingUsername && usernameAvailable === true && (
                           <div className="w-8 h-8 rounded-full bg-[#388E3C]/10 flex items-center justify-center border border-[#388E3C]/20">
                             <CheckCircle2 className="w-5 h-5 text-[#388E3C]" />
                           </div>
                         )}
                         {!checkingUsername && usernameAvailable === false && (
                           <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
                             <span className="text-red-500 font-black text-xl">×</span>
                           </div>
                         )}
                      </div>
                    </div>

                    {usernameAvailable === false && !checkingUsername && (
                      <p className="text-sm text-red-400 font-bold px-2">This handle is already claimed by another neighbor</p>
                    )}

                    {showSuggestions && usernameSuggestions.length > 0 && (
                      <div className="bg-background/80 rounded-[32px] p-6 space-y-5 border border-border animate-in fade-in zoom-in-95 duration-500 backdrop-blur-3xl shadow-[0_30px_60px_-12px_rgba(0,0,0,0.8)]">
                        <div className="flex items-center gap-3 text-[0.6875rem] uppercase tracking-[0.25em] font-black text-[#388E3C]">
                          <div className="w-10 h-10 rounded-xl bg-[#388E3C]/10 flex items-center justify-center border border-[#388E3C]/20">
                            <Lightbulb className="w-5 h-5" />
                          </div>
                          <span>Recommended Handles</span>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {usernameSuggestions.map((suggestion, index) => (
                            <button
                              key={index}
                              type="button"
                              onClick={() => handleUseSuggestion(suggestion)}
                              className="px-6 py-3 text-sm bg-white/5 text-white font-bold rounded-2xl border border-border hover:border-[#388E3C]/40 hover:bg-[#388E3C]/10 transition-all hover:scale-105 active:scale-95"
                            >
                              @{suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Location Grid */}
                  <div className="space-y-8 pt-8 border-t border-border">
                    <div className="flex items-center justify-between">
                      <h3 className="text-2xl font-black text-foreground tracking-tight">Geographic Sector</h3>
                    </div>

                    {!showManualLocation ? (
                      <GpsLocationStep
                        onLocationFound={(loc) => {
                          form.setValue('location.state', loc.state);
                          form.setValue('location.lga', loc.lga);
                          form.setValue('location.ward', loc.ward);
                          if (loc.lat && loc.lng) {
                            setGpsLocation({ lat: loc.lat, lng: loc.lng });
                          }
                        }}
                        onFallbackToManual={() => setShowManualLocation(true)}
                      />
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="space-y-3">
                          <Label className="text-[0.6875rem] uppercase tracking-widest font-black text-muted-foreground ml-1">State / Region</Label>
                          <Select value={form.watch('location.state')} onValueChange={handleStateChange}>
                            <SelectTrigger className="h-16 rounded-[22px] bg-muted/50 border-border text-lg font-bold px-6 focus:ring-[#388E3C]/30">
                              <SelectValue placeholder="Select State" />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border max-h-[300px] rounded-2xl shadow-2xl backdrop-blur-3xl">
                              {states.filter(s => s).map(state => (
                                <SelectItem key={state} value={state} className="focus:bg-[#388E3C] focus:text-white font-bold py-3 px-6 rounded-xl cursor-pointer transition-colors">{state}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-3">
                          <Label className="text-[0.6875rem] uppercase tracking-widest font-black text-muted-foreground ml-1">Local Gov Area</Label>
                          <Select 
                            value={form.watch('location.lga')} 
                            onValueChange={handleLgaChange}
                            disabled={!form.watch('location.state')}
                          >
                            <SelectTrigger className="h-16 rounded-[22px] bg-muted/50 border-border text-lg font-bold px-6 focus:ring-[#388E3C]/30 disabled:opacity-30">
                              <SelectValue placeholder="Select LGA" />
                            </SelectTrigger>
                            <SelectContent className="bg-card border-border max-h-[300px] rounded-2xl shadow-2xl backdrop-blur-3xl">
                              {lgas.filter(l => l).map(lga => (
                                <SelectItem key={lga} value={lga} className="focus:bg-[#388E3C] focus:text-white font-bold py-3 px-6 rounded-xl cursor-pointer transition-colors">{lga}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        {/* Option to try GPS again */}
                        <div className="col-span-full flex justify-end">
                          <button
                            type="button"
                            onClick={() => setShowManualLocation(false)}
                            className="text-sm font-bold text-[#388E3C] hover:text-[#2E7D32] transition-colors"
                          >
                            Use Auto-Detect instead
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-6 pt-10">
                  <button 
                    type="submit" 
                    disabled={isSubmitting || usernameAvailable === false || checkingUsername}
                    className="w-full h-20 rounded-[28px] flex items-center justify-center text-white text-2xl font-black transition-all active:scale-[0.98] disabled:opacity-50 disabled:grayscale overflow-hidden relative group"
                    style={{
                      background: "#388E3C",
                      boxShadow: "0 25px 50px -12px rgba(56,142,60,0.5)"
                    }}
                  >
                    <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500" />
                    <span className="relative z-10 flex items-center gap-4">
                      {isSubmitting ? (
                        <>
                          <div className="w-7 h-7 border-4 border-white border-t-transparent rounded-full animate-spin" />
                          Syncing Identity...
                        </>
                      ) : (
                        <>
                          Finalize Citizenship
                          <ArrowLeft className="w-7 h-7 rotate-180" />
                        </>
                      )}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>

          <div className="flex flex-col items-center gap-6 py-8">
             <div className="flex items-center gap-3 text-[0.6875rem] font-black text-[#388E3C] uppercase tracking-[0.3em]">
               <CheckCircle2 className="w-4 h-4" />
               Identity Encryption Active
             </div>
             <p className="text-center text-[0.625rem] text-muted-foreground/70 font-black uppercase tracking-[0.4em] max-w-xs leading-loose">
               Securely connecting 10k+ verified neighbors across Nigeria
             </p>
          </div>
        </div>
      </div>
    </div>
  );
}
