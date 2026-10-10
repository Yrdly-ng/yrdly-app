import { safeRelativePath } from './auth-navigation';
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
  share_location?: boolean;
  discoverable?: boolean;
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
          emailRedirectTo: typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined,
          data: {
            name,
            username,
          },
        },
      });

      if (error) {
        if (data?.user) {
          return { user: data.user, error: null };
        }
        const errMsg = (error.message || "").toLowerCase();
        if (errMsg.includes("already registered") || errMsg.includes("already in use") || errMsg.includes("user_already_exists")) {
          return {
            user: null,
            error: new Error("An account with this email address already exists. Please log in instead."),
          };
        }
        throw error;
      }

      // Supabase email enumeration protection returns empty identities array for existing users
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return {
          user: null,
          error: new Error("An account with this email address already exists. Please log in instead."),
        };
      }

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

      if (data.user) {
        const { data: profile, error: profileError } = await supabase
          .from('users')
          .select('is_suspended, is_banned, status, suspension_reason')
          .eq('id', data.user.id)
          .maybeSingle();

        if (profileError || !profile) {
          await supabase.auth.signOut();
          throw new Error('Account status could not be verified. Please try again.');
        }
        if (profile && (profile.is_suspended || profile.is_banned || profile.status === 'suspended' || profile.status === 'banned')) {
          await supabase.auth.signOut();
          return {
            user: null,
            error: new Error('Your account has been suspended or banned. You cannot log in or transact.'),
          };
        }
      }

      return { user: data.user, error: null };
    } catch (error) {
      console.error('Sign in error:', error);
      return { user: null, error };
    }
  }

  // Sign in with Google
  static async signInWithGoogle(next?: string) {
    try {
      // Always redirect back to the current origin (works for any domain)
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      const destination = safeRelativePath(next, '');
      if (destination) callbackUrl.searchParams.set('next', destination);
      const redirectUrl = callbackUrl.toString();
        
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
  static async signInWithApple(next?: string) {
    try {
      // Always redirect back to the current origin (works for any domain)
      const callbackUrl = new URL('/auth/callback', window.location.origin);
      const destination = safeRelativePath(next, '');
      if (destination) callbackUrl.searchParams.set('next', destination);
      const redirectUrl = callbackUrl.toString();
        
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
  static async updateUserProfile(userId: string, updates: Partial<AuthUser> & Record<string, any>) {
    try {
      const allowed = new Set(['name', 'legal_name', 'username', 'avatar_url', 'bio',
        'interests', 'notification_settings', 'share_location', 'current_location',
        'location_updated_at', 'location', 'home_state', 'home_lga', 'home_ward',
        'home_lat', 'home_lng', 'profile_completed', 'onboarding_status',
        'onboarding_completed_at', 'tour_completed', 'discoverable', 'is_online', 'last_seen']);
      const cleanUpdates = Object.fromEntries(Object.entries(updates).filter(([key]) => allowed.has(key)));

      if (cleanUpdates.username) {
        cleanUpdates.username = cleanUpdates.username.replace(/^@/, '').trim().toLowerCase();
      }

      const { error } = await supabase
        .from('users')
        .update(cleanUpdates)
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
        .from('escrow_transactions')
        .select('id')
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .in('status', ['pending', 'paid', 'shipped', 'delivered', 'disputed'])
        .limit(1);

      if (pendingTx && pendingTx.length > 0) {
        return { canDelete: false, reason: 'You have active escrow transactions in progress. Please complete or cancel them before deleting your account.' };
      }

      // Check for open disputes
      const { data: openDisputes } = await supabase
        .from('escrow_transactions')
        .select('id')
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`)
        .eq('status', 'disputed')
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
        .from('public_profiles')
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
