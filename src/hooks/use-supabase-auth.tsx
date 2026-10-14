"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { User } from "@supabase/supabase-js";
import { AuthService, AuthUser } from "@/lib/auth-service";
import { supabase } from "@/lib/supabase";
import { watchSession } from "@/lib/session-policy";
import { clientFeedState } from "@/lib/client-feed-state";

interface AuthContextType {
  user: User | null;
  profile: AuthUser | null;
  loading: boolean;
  signUp: (
    email: string,
    password: string,
    name: string,
    username?: string,
  ) => Promise<{ user: User | null; error: any }>;
  signIn: (
    email: string,
    password: string,
  ) => Promise<{ user: User | null; error: any }>;
  signInWithGoogle: (next?: string) => Promise<{ data: any; error: any }>;
  signInWithApple: (next?: string) => Promise<{ data: any; error: any }>;
  signOut: () => Promise<{ error: any }>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  updatePassword: (newPassword: string) => Promise<{ error: any }>;
  updateProfile: (updates: Partial<AuthUser>) => Promise<void>;
  sendPhoneOtp: (
    phone: string,
  ) => Promise<{ pinId: string | null; error: any }>;
  verifyPhoneOtp: (
    pinId: string,
    otp: string,
  ) => Promise<{ verified: boolean; error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => watchSession(), []);
  useLayoutEffect(() => {
    clientFeedState.setAccount(user?.id ?? null);
  }, [user?.id]);
  const profileCreationInProgress = useRef(false);
  useEffect(() => {
    let mounted = true,
      version = 0;
    let owner: string | null = null;
    let profileChannel: ReturnType<typeof supabase.channel> | null = null;
    const stopProfile = () => {
      if (profileChannel) {
        void supabase.removeChannel(profileChannel);
        profileChannel = null;
      }
    };
    const applySession = async (nextUser: User | null) => {
      const request = ++version;
      const nextOwner = nextUser?.id ?? null;
      if (nextOwner !== owner) {
        stopProfile();
        setProfile(null);
      }
      owner = nextOwner;
      clientFeedState.setAccount(owner);
      if (!mounted) return;
      setUser(nextUser);
      if (!nextUser) {
        setProfile(null);
        setLoading(false);
        return;
      }
      try {
        const result = await supabase
          .from("users")
          .select("*")
          .eq("id", nextUser.id)
          .abortSignal(AbortSignal.timeout(10000))
          .maybeSingle();
        if (!mounted || version !== request) return;
        if (result.error) throw result.error;
        let fresh = result.data as AuthUser | null;
        // Only a successful empty query may create a missing profile.
        if (!fresh && !profileCreationInProgress.current) {
          profileCreationInProgress.current = true;
          try {
            await AuthService.createUserProfile(
              nextUser,
              nextUser.user_metadata?.name ||
                nextUser.user_metadata?.full_name ||
                nextUser.email?.split("@")[0] ||
                "User",
            );
            fresh = await AuthService.getUserProfile(nextUser.id);
          } finally {
            profileCreationInProgress.current = false;
          }
        }
        if (mounted && request === version) setProfile(fresh);
      } catch {
        /* Preserve the current account profile during a temporary outage. */
      } finally {
        if (mounted && request === version) setLoading(false);
      }
      if (!mounted || version !== request || profileChannel) return;
      profileChannel = supabase
        .channel(`user-profile-${nextUser.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "users",
            filter: `id=eq.${nextUser.id}`,
          },
          (payload) => {
            if (mounted && owner === nextUser.id)
              setProfile(
                (previous) => ({ ...previous, ...payload.new }) as AuthUser,
              );
          },
        )
        .subscribe();
    };
    void AuthService.getCurrentUser().then((initial) => {
      if (mounted && version === 0) void applySession(initial);
    });
    const {
      data: { subscription },
    } = AuthService.onAuthStateChange((next) => {
      if (mounted) void applySession(next);
    });
    return () => {
      mounted = false;
      version++;
      subscription.unsubscribe();
      stopProfile();
    };
  }, []);

  const signUp = async (
    email: string,
    password: string,
    name: string,
    username?: string,
  ) => {
    setLoading(true);
    try {
      const result = await AuthService.signUp(email, password, name, username);
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

  const signInWithGoogle = async (next?: string) => {
    setLoading(true);
    try {
      const result = await AuthService.signInWithGoogle(next);
      return result;
    } finally {
      setLoading(false);
    }
  };

  const signInWithApple = async (next?: string) => {
    setLoading(true);
    try {
      const result = await AuthService.signInWithApple(next);
      return result;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    setLoading(true);
    try {
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
    if (!user) throw new Error("No user logged in");

    try {
      await AuthService.updateUserProfile(user.id, updates);

      const updatedProfile = profile ? { ...profile, ...updates } : null;
      setProfile(updatedProfile);
    } catch (error) {
      console.error("Error updating profile:", error);
      throw error;
    }
  };

  const sendPhoneOtp = async (phone: string) => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "send-phone-otp",
        {
          body: { phone },
        },
      );

      if (error) throw error;
      if (data.error) throw new Error(data.error);

      return { pinId: data.pinId, error: null };
    } catch (error: any) {
      console.error("sendPhoneOtp error:", error);
      return { pinId: null, error: error.message || error };
    }
  };

  const verifyPhoneOtp = async (pinId: string, otp: string) => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "verify-phone-otp",
        {
          body: { pinId, pin: otp },
        },
      );

      if (error) throw error;
      if (data.error) {
        let errMessage = data.error;
        if (
          typeof errMessage === "string" &&
          (errMessage.toLowerCase().includes("token") ||
            errMessage.toLowerCase().includes("expired"))
        ) {
          errMessage =
            "The verification code has expired. Please request a new code and try again.";
        }
        throw new Error(errMessage);
      }

      if (profile) {
        setProfile({ ...profile, phone_verified: true });
      }

      return { verified: true, error: null };
    } catch (error: any) {
      console.error("verifyPhoneOtp error:", error);
      let errMessage = error.message || error;
      if (
        typeof errMessage === "string" &&
        (errMessage.toLowerCase().includes("token") ||
          errMessage.toLowerCase().includes("expired"))
      ) {
        errMessage =
          "The verification code has expired. Please request a new code and try again.";
      }
      return { verified: false, error: errMessage };
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
    sendPhoneOtp,
    verifyPhoneOtp,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
