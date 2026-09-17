"use client";

import { ProfileScreen } from "@/components/ProfileScreen";
import { useAuth } from "@/hooks/use-supabase-auth";

export default function ProfilePage() {
  const { user } = useAuth();
  
  // isOwnProfile is true when viewing own profile (no userId in route)
  // This page is for the logged-in user's own profile
  return <ProfileScreen isOwnProfile={true} targetUserId={user?.id} />;
}

