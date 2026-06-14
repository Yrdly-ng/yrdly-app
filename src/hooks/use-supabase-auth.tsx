'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { AuthService, AuthUser } from '@/lib/auth-service';
import { supabase } from '@/lib/supabase';
import posthog from 'posthog-js';

interface AuthContextType {
  user: User | null;
  profile: AuthUser | null;
  loading: boolean;
  signUp: (email: string, password: string, name: string) => Promise<{ user: User | null; error: any }>;
  signIn: (email: string, password: string) => Promise<{ user: User | null; error: any }>;
  signInWithGoogle: () => Promise<{ data: any; error: any }>;
  signInWithApple: () => Promise<{ data: any; error: any }>;
  signOut: () => Promise<{ error: any }>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  updatePassword: (newPassword: string) => Promise<{ error: any }>;
  updateProfile: (updates: Partial<AuthUser>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileCreationInProgress, setProfileCreationInProgress] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let profileChannel: any = null;

    // Get initial session
    const getInitialSession = async () => {
      try {
        const currentUser = await AuthService.getCurrentUser();
        if (isMounted) {
          setUser(currentUser);
          
          if (currentUser) {
            try {
              // First, try to get existing profile
              let userProfile = await AuthService.getUserProfile(currentUser.id);
              
              // If no profile exists, create one
              if (!userProfile && !profileCreationInProgress) {
                setProfileCreationInProgress(true);
                try {
                  await AuthService.createUserProfile(currentUser, 
                    currentUser.user_metadata?.name || 
                    currentUser.user_metadata?.full_name ||
                    currentUser.user_metadata?.display_name ||
                    currentUser.user_metadata?.given_name ||
                    currentUser.email?.split('@')[0] || 
                    'User'
                  );
                  // Fetch the newly created profile
                  userProfile = await AuthService.getUserProfile(currentUser.id);
                } catch (createError) {
                  console.error('Error creating user profile on initial load:', createError);
                } finally {
                  setProfileCreationInProgress(false);
                }
              }
              
              if (isMounted) {
                setProfile(userProfile);
              }
            } catch (error) {
              console.error('Error fetching user profile:', error);
              if (isMounted) {
                setProfile(null);
              }
            }
          } else {
            // No user, ensure profile is also null
            if (isMounted) {
              setProfile(null);
            }
          }
        }
      } catch (error) {
        // Don't log AuthSessionMissingError as it's expected when user is logged out
        if (error instanceof Error && error.message !== 'Auth session missing!') {
          console.error('Error getting initial session:', error);
        }
        if (isMounted) {
          setUser(null);
          setProfile(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    const setupProfileRealtime = (userId: string) => {
      // Set up real-time subscription for profile updates
      profileChannel = supabase
        .channel(`user-profile-${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'users',
            filter: `id=eq.${userId}`,
          },
          async (payload) => {
            if (isMounted && payload.new) {
              // Use the new payload directly instead of fetching which may return stale data
              setProfile((prev) => {
                if (!prev) return payload.new as AuthUser;
                return { ...prev, ...(payload.new as Partial<AuthUser>) };
              });
            }
          }
        )
        .subscribe();
    };

    getInitialSession();

    // Listen for auth state changes
    const { data: { subscription } } = AuthService.onAuthStateChange(async (user) => {
      if (isMounted) {
        setUser(user);

        if (user) {
          posthog.identify(user.id, {
            email: user.email,
            name: user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split('@')[0],
          });

          try {
            // First, try to get existing profile
            let userProfile = await AuthService.getUserProfile(user.id);
            
            // If no profile exists, create one
            if (!userProfile && !profileCreationInProgress) {
              setProfileCreationInProgress(true);
              try {
                await AuthService.createUserProfile(user, 
                  user.user_metadata?.name || 
                  user.user_metadata?.full_name ||
                  user.user_metadata?.display_name ||
                  user.user_metadata?.given_name ||
                  user.email?.split('@')[0] || 
                  'User'
                );
                // Fetch the newly created profile
                userProfile = await AuthService.getUserProfile(user.id);
              } catch (createError) {
                console.error('Error creating user profile:', createError);
              } finally {
                setProfileCreationInProgress(false);
              }
            }
            
            if (isMounted) {
              setProfile(userProfile);
              // Set up real-time subscription for this user's profile
              setupProfileRealtime(user.id);
            }
          } catch (error) {
            console.error('Error fetching user profile:', error);
            if (isMounted) {
              setProfile(null);
            }
          }
        } else {
          setProfile(null);
          // Clean up profile subscription
          if (profileChannel) {
            supabase.removeChannel(profileChannel);
            profileChannel = null;
          }
        }
        
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      if (profileChannel) {
        supabase.removeChannel(profileChannel);
      }
    };
  }, [profileCreationInProgress]);

  const signUp = async (email: string, password: string, name: string) => {
    setLoading(true);
    try {
      const result = await AuthService.signUp(email, password, name);
      return result;
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    setLoading(true);
    try {
      const result = await AuthService.signIn(email, password);
      return result;
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setLoading(true);
    try {
      const result = await AuthService.signInWithGoogle();
      return result;
    } finally {
      setLoading(false);
    }
  };

  const signInWithApple = async () => {
    setLoading(true);
    try {
      const result = await AuthService.signInWithApple();
      return result;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
      posthog.capture('user_signed_out');
      posthog.reset();
      const result = await AuthService.signOut();
      setUser(null);
      setProfile(null);
      return result;
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (email: string) => {
    return await AuthService.resetPassword(email);
  };

  const updatePassword = async (newPassword: string) => {
    return await AuthService.updatePassword(newPassword);
  };

  const updateProfile = async (updates: Partial<AuthUser>) => {
    if (!user) throw new Error('No user logged in');
    
    try {
      await AuthService.updateUserProfile(user.id, updates);
      
      const updatedProfile = profile ? { ...profile, ...updates } : null;
      setProfile(updatedProfile);
    } catch (error) {
      console.error('Error updating profile:', error);
      throw error;
    }
  };

  const value = {
    user,
    profile,
    loading,
    signUp,
    signIn,
    signInWithGoogle,
    signInWithApple,
    signOut,
    resetPassword,
    updatePassword,
    updateProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

