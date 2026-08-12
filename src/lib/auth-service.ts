import { supabase } from './supabase';
import { User } from '@supabase/supabase-js';

export interface AuthUser {
  id: string;
  email?: string;
  name?: string;
  username?: string;
  avatar_url?: string;
  bio?: string;
  phone?: string;
  phone_verified?: boolean;
  location?: {
    state?: string;
    lga?: string;
    city?: string;
    ward?: string;
  };
  friends?: string[];
  blocked_users?: string[];
  interests?: string[];
  shareLocation?: boolean;
  notification_settings?: {
    friendRequests: boolean;
    messages: boolean;
    postUpdates: boolean;
    comments: boolean;
    postLikes: boolean;
    eventInvites: boolean;
  };
  is_online?: boolean;
  last_seen?: string;
  // Onboarding fields
  onboarding_status?: 'signup' | 'email_verification' | 'profile_setup' | 'welcome' | 'tour' | 'completed';
  profile_completed?: boolean;
  onboarding_completed_at?: string;
  tour_completed?: boolean;
  welcome_message_sent?: boolean;
  // Canonical home location columns (matches mobile schema)
  home_state?: string | null;
  home_lga?: string | null;
  home_ward?: string | null;
  home_lat?: number | null;
  home_lng?: number | null;
  home_location_geom?: string | null;
  created_at?: string;
  updated_at?: string;
}

export class AuthService {
  static async signUp(email: string, password: string, name: string, username?: string) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            name,
            username,
          },
        },
      });

      if (error) throw error;

      // Note: User profile will be created automatically after email confirmation
      // via the onAuthStateChange listener in the AuthProvider
      return { user: data.user, error: null };
    } catch (error) {
      console.error('Sign up error:', error);
      return { user: null, error };
    }
  }

  // Sign in with email and password
  static async signIn(email: string, password: string) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      return { user: data.user, error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      return { user: null, error };
    }
  }

  // Sign in with Google
  static async signInWithGoogle() {
    try {
      // Always redirect back to the current origin (works for any domain)
      const redirectUrl = `${window.location.origin}/auth/callback`;
        
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('Google sign in error:', error);
      return { data: null, error };
    }
  }

  // Sign in with Apple
  static async signInWithApple() {
    try {
      // Always redirect back to the current origin (works for any domain)
      const redirectUrl = `${window.location.origin}/auth/callback`;
        
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (error) throw error;

      return { data, error: null };
    } catch (error) {
      console.error('Apple sign in error:', error);
      return { data: null, error };
    }
  }

  // Sign out
  static async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Sign out error:', error);
      return { error };
    }
  }

  // Get current user
  // Uses getSession() instead of getUser() for this check: getSession()
  // reads the session from local storage synchronously (no network round
  // trip), while getUser() re-verifies the token against Supabase's auth
  // server on every call. That server round trip was adding significant
  // delay before the app could paint anything. onAuthStateChange (already
  // wired up in use-supabase-auth.tsx) keeps this in sync afterward.
  static async getCurrentUser(): Promise<User | null> {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        // Don't log AuthSessionMissingError as it's expected when user is logged out
        if (error.message !== 'Auth session missing!') {
          console.error('Get current user error:', error);
        }
        return null;
      }
      return session?.user ?? null;
    } catch (error: any) {
      // Don't log AuthSessionMissingError as it's expected when user is logged out
      if (error.message !== 'Auth session missing!') {
        console.error('Get current user error:', error);
      }
      return null;
    }
  }

  // Get user profile from public.users table
  static async getUserProfile(userId: string): Promise<AuthUser | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle(); // Use maybeSingle() instead of single() to handle 0 rows gracefully

      if (error) {
        console.error('Database error fetching user profile:', error);
        return null;
      }
      
      return data;
    } catch (error) {
      console.error('Get user profile error:', error);
      return null;
    }
  }

  // Create user profile in public.users table
  static async createUserProfile(user: User, name: string) {
    try {
      // First check if profile already exists
      const existingProfile = await this.getUserProfile(user.id);
      if (existingProfile) {
        return;
      }

      const finalName = name || user.user_metadata?.name || user.email?.split('@')[0];

      const { error } = await supabase
        .from('users')
        .insert({
          id: user.id,
          name: finalName,
          email: user.email,
          avatar_url: user.user_metadata?.avatar_url,
          // All users must complete profile setup to set their location
          profile_completed: false,
          onboarding_status: 'profile_setup',
          notification_settings: {
            friendRequests: true,
            messages: true,
            postUpdates: true,
            comments: true,
            postLikes: true,
            eventInvites: true,
          },
        });

      if (error) {
        // If it's a duplicate key error, the profile already exists, which is fine
        if (error.code === '23505') {
          return;
        }
        console.error('Database error creating user profile:', error);
        throw error;
      }
    } catch (error) {
      console.error('Create user profile error:', error);
      throw error;
    }
  }

  // Update user profile
  static async updateUserProfile(userId: string, updates: Partial<AuthUser>) {
    try {
      if (updates.username) {
        updates.username = updates.username.replace(/^@/, '').trim().toLowerCase();
      }

      const { error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', userId);

      if (error) throw error;
    } catch (error) {
      console.error('Update user profile error:', error);
      throw error;
    }
  }

  // Check if account can be safely deleted without pending transactions/disputes
  static async canDeleteAccount(userId: string): Promise<{ canDelete: boolean; reason?: string }> {
    try {
      // Check for pending escrow transactions
      const { data: pendingTx } = await supabase
        .from('transactions')
        .select('id')
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .eq('status', 'pending_escrow')
        .limit(1);

      if (pendingTx && pendingTx.length > 0) {
        return { canDelete: false, reason: 'You have active escrow transactions in progress. Please complete or cancel them before deleting your account.' };
      }

      // Check for open disputes
      const { data: openDisputes } = await supabase
        .from('disputes')
        .select('id')
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .eq('status', 'open')
        .limit(1);

      if (openDisputes && openDisputes.length > 0) {
        return { canDelete: false, reason: 'You have open marketplace disputes. Please resolve all open disputes before deleting your account.' };
      }

      return { canDelete: true };
    } catch (e) {
      return { canDelete: true };
    }
  }

  // Check if a username is available (case-insensitive)
  static async checkUsernameAvailability(username: string, excludeUserId?: string): Promise<boolean> {
    try {
      const clean = username.replace(/^@/, '').trim().toLowerCase();
      if (!clean) return true;

      let query = supabase
        .from('users')
        .select('id')
        .ilike('username', clean);

      if (excludeUserId) {
        query = query.neq('id', excludeUserId);
      }

      const { data, error } = await query;
      if (error) {
        console.error('Error checking username availability:', error);
        return true;
      }

      return !data || data.length === 0;
    } catch (e) {
      console.error('Check username availability error:', e);
      return true;
    }
  }

  // Reset password
  static async resetPassword(email: string) {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Reset password error:', error);
      return { error };
    }
  }

  // Update password
  static async updatePassword(newPassword: string) {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Update password error:', error);
      return { error };
    }
  }

  // Listen to auth state changes
  static onAuthStateChange(callback: (user: User | null) => void) {
    return supabase.auth.onAuthStateChange((event, session) => {
      callback(session?.user ?? null);
    });
  }
}