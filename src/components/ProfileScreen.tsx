"use client";

import { useState, useEffect, useCallback, useMemo, useRef as reactUseRef } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, MapPin, Calendar, Users, MessageCircle, ShoppingBag,
  Briefcase, CalendarDays, Clock, Heart, MoreHorizontal, UserMinus,
  Ticket, Package, ChevronRight, TrendingUp, Shield, Check, X, BadgeCheck, Star, Play, Bookmark, Settings, Camera
} from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import type { User, Post } from "@/types";
import { NotificationTriggers } from "@/lib/notification-triggers";
import { FriendsList } from "./FriendsList";
import { useToast } from "@/hooks/use-toast";
import { ActivityIndicator } from "@/components/ActivityIndicator";
import Image from "next/image";
import { ProfileQuickAccess } from "./ProfileQuickAccess";
import { CreateBusinessDialog } from "./CreateBusinessDialog";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { ProfilePostGridItem } from "@/components/ProfilePostGridItem";
import { RightRail } from "@/components/RightRail";
import { useFriendshipGlobal } from "@/hooks/use-friendship-global";
import { GlassCard } from "@/components/ui/glass-card";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const GREEN = "hsl(var(--primary))";

interface ProfileScreenProps {
  onBack?: () => void;
  user?: User;
  isOwnProfile?: boolean;
  targetUserId?: string;
  targetUser?: User;
}

// ─── Tab pill bar ────────────────────────────────────────────────────────────
const TABS = [
  { key: "posts", label: "Posts" },
  { key: "texts", label: "Texts" },
  { key: "saved", label: "Saved" },
];

function TabBar({ active, onChange }: { active: string; onChange: (k: string) => void }) {
  return (
    <div
      className="flex items-center justify-around p-1 rounded-full border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-md font-yrdly-body"
    >
      {TABS.map(({ key, label }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex-1 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all text-center ${
              isActive
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-[var(--yrdly-label)] hover:text-foreground"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function MiniCard({ title, sub, img, badge, onClick }: {
  title: string; sub?: string; img?: string | null; badge?: string; onClick?: () => void;
}) {
  return (
    <GlassCard
      onClick={onClick}
      className="flex items-center gap-3 p-3 rounded-[11px] cursor-pointer transition-colors hover:bg-white/5"
    >
      <div className="w-12 h-12 rounded-[11px] overflow-hidden bg-[var(--yrdly-glass-bg)] flex-shrink-0 relative">
        {img ? (
          <Image src={img} alt={title} fill className="object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-primary font-bold text-sm font-yrdly-display">
            {title.charAt(0)}
          </div>
        )}
        {badge && (
          <span
            className="absolute bottom-0 right-0 text-[0.55rem] font-bold px-1.5 py-0.5 rounded-tl text-black font-yrdly-body"
            style={{ background: GREEN }}
          >{badge}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-foreground text-sm font-semibold truncate font-yrdly-display">{title}</p>
        {sub && <p className="text-xs truncate mt-0.5 text-[var(--yrdly-label)] font-yrdly-body">{sub}</p>}
      </div>
    </GlassCard>
  );
}

function isMediaPost(p: any): boolean {
  return !!p.image_url || !!(p.image_urls && p.image_urls.length > 0) || !!p.video_url || !!(p.video_urls && p.video_urls.length > 0) || !!p.video_thumbnail_url;
}

export function ProfileScreen({ onBack, user, isOwnProfile = true, targetUserId, targetUser: externalTargetUser }: ProfileScreenProps) {
  const router = useRouter();
  const { user: currentUser, profile: currentProfile } = useAuth();
  const { toast } = useToast();

  const [profileData, setProfileData] = useState<any>(null);
  const [userPosts, setUserPosts] = useState<Post[]>([]);
  const [savedPosts, setSavedPosts] = useState<any[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("posts");
  const [showFriendsList, setShowFriendsList] = useState(false);
  const [showRemoveFriendDialog, setShowRemoveFriendDialog] = useState(false);
  const [showAvatarPreview, setShowAvatarPreview] = useState(false);
  const [stats, setStats] = useState({ friends: 0, events: 0, followers: 0, following: 0 });
  const hasTriggeredViewRef = reactUseRef<boolean>(false);

  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [isCreateBusinessOpen, setIsCreateBusinessOpen] = useState(false);
  const [hasBusiness, setHasBusiness] = useState(false);
  const [userBusinessId, setUserBusinessId] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser?.id) {
      supabase.from("businesses").select("id").eq("owner_id", currentUser.id).then(({ data }) => {
        if (data && data.length > 0) {
          setHasBusiness(true);
          setUserBusinessId(data[0].id);
        }
      });
    }
  }, [currentUser?.id]);

  const targetUser = externalTargetUser || user || currentUser;
  const targetProfile = externalTargetUser ? null : (user ? null : currentProfile);
  const isExternalProfile = !!targetUserId && targetUserId !== currentUser?.id;
  const actualIsOwnProfile = isOwnProfile !== undefined ? isOwnProfile : !isExternalProfile;

  const mediaPosts = useMemo(() => userPosts.filter(isMediaPost), [userPosts]);
  const textPosts  = useMemo(() => userPosts.filter((p) => !isMediaPost(p)), [userPosts]);

  const fetchSavedPosts = useCallback(async () => {
    if (!targetUser) return;
    setLoadingSaved(true);
    try {
      const [postRes, eventRes, businessRes] = await Promise.all([
        supabase.from('post_bookmarks').select('post_id, created_at, posts(*)').eq('user_id', targetUser.id),
        supabase.from('event_bookmarks').select('event_id, created_at, events(*)').eq('user_id', targetUser.id),
        supabase.from('business_favorites').select('business_id, created_at, businesses(*)').eq('user_id', targetUser.id),
      ]);

      const extractedPosts = (postRes.data || [])
        .filter((item: any) => item.posts != null && item.posts.moderation_status !== 'rejected')
        .map((item: any) => ({ ...item.posts, bookmark_created_at: item.created_at }));

      const extractedEvents = (eventRes.data || [])
        .filter((item: any) => item.events != null)
        .map((item: any) => ({
          id: item.events.id,
          text: item.events.title,
          title: item.events.title,
          image_urls: item.events.image_urls?.length ? item.events.image_urls : item.events.cover_image_url ? [item.events.cover_image_url] : [],
          category: 'Event',
          event_link: `/events/${item.events.id}`,
          bookmark_created_at: item.created_at,
        }));

      const extractedBusinesses = (businessRes.data || [])
        .filter((item: any) => item.businesses != null)
        .map((item: any) => ({
          id: item.businesses.id,
          text: item.businesses.name,
          title: item.businesses.name,
          image_urls: item.businesses.logo || item.businesses.cover_image || item.businesses.image_urls?.[0] ? [item.businesses.logo || item.businesses.cover_image || item.businesses.image_urls?.[0]] : [],
          category: 'Business',
          event_link: `/businesses/${item.businesses.id}`,
          bookmark_created_at: item.created_at,
        }));

      const combined = [...extractedPosts, ...extractedEvents, ...extractedBusinesses].sort(
        (a, b) => new Date(b.bookmark_created_at).getTime() - new Date(a.bookmark_created_at).getTime()
      );
      setSavedPosts(combined);
    } catch (e) {
      console.error('Error fetching saved items:', e);
    } finally {
      setLoadingSaved(false);
    }
  }, [targetUser]);

  useEffect(() => {
    if (activeTab === "saved") {
      fetchSavedPosts();
    }
  }, [activeTab, fetchSavedPosts]);

  // ── Shared friendship hook (only active when viewing another user's profile) ──
  const friendship = useFriendshipGlobal(
    !actualIsOwnProfile && targetUser?.id !== currentUser?.id ? targetUser?.id : undefined
  );
  const friendshipStatus = friendship.status;

  const refreshProfileData = useCallback(async () => {
    if (!targetUser) return;
    const { data } = await supabase.from("users").select("*, friends").eq("id", targetUser.id).single();
    if (data) { setStats((p) => ({ ...p, friends: data.friends?.length || 0 })); setProfileData(data); }
  }, [targetUser]);

  useEffect(() => { if (targetUser) refreshProfileData(); }, [targetUser?.id, refreshProfileData, targetUser]);

  useEffect(() => {
    if (!targetUser) return;
    const fetch = async () => {
      const { data: userData } = await supabase.from("users").select("*, friends").eq("id", targetUser.id).single();
      if (userData) setProfileData(userData);

      const [postsRes, followersRes, followingRes] = await Promise.all([
        supabase.from("posts").select("*").eq("user_id", targetUser.id).order("timestamp", { ascending: false }).limit(40),
        supabase.from("followers").select("id", { count: "exact", head: true }).eq("following_id", targetUser.id),
        supabase.from("followers").select("id", { count: "exact", head: true }).eq("follower_id", targetUser.id),
      ]);

      if (currentUser?.id && targetUser.id !== currentUser.id) {
        const { data: fData } = await supabase.from('followers').select('id').eq('follower_id', currentUser.id).eq('following_id', targetUser.id).maybeSingle();
        setIsFollowing(!!fData);
      }

      setUserPosts(postsRes.data || []);
      setStats({
        friends: userData?.friends?.length || 0,
        events: 0,
        followers: followersRes.count || 0,
        following: followingRes.count || 0,
      });
      setLoading(false);
      
      if (!hasTriggeredViewRef.current && currentUser?.id && targetUser.id !== currentUser.id) {
          hasTriggeredViewRef.current = true;
          NotificationTriggers.onProfileView(targetUser.id, currentUser.id).catch(console.error);
      }
    };
    fetch();
  }, [targetUser, targetProfile, currentUser, hasTriggeredViewRef]);

  const handleToggleFollow = async () => {
    if (!currentUser || !targetUser) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await supabase.from('followers').delete().eq('follower_id', currentUser.id).eq('following_id', targetUser.id);
        setIsFollowing(false);
      } else {
        await supabase.from('followers').insert({ follower_id: currentUser.id, following_id: targetUser.id });
        setIsFollowing(true);
      }
    } catch (e: any) {
      toast({ variant: 'destructive', description: e.message });
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 space-y-5 max-w-2xl mx-auto min-h-[100dvh] bg-[var(--yrdly-dark)]">
        <Skeleton className="h-64 w-full rounded-[11px]" />
        <Skeleton className="h-20 w-full rounded-[11px]" />
      </div>
    );
  }

  const displayUser = profileData || targetUser;
  const displayProfile = isExternalProfile ? profileData : (targetProfile ?? profileData);
  const name = (displayProfile as any)?.name || (displayUser as any)?.name || "Anonymous";
  const username = (displayProfile as any)?.username || (displayUser as any)?.user_metadata?.username || (displayUser as any)?.email?.split("@")[0] || "user";
  const bio = (displayProfile as any)?.bio;
  const avatarUrl = (displayProfile as any)?.avatar_url || (displayUser as any)?.avatar_url;
  
  const formattedLocation = [
    (displayProfile as any)?.home_ward,
    (displayProfile as any)?.home_lga,
    (displayProfile as any)?.home_state || (displayProfile as any)?.location?.state
  ].filter(Boolean).join(", ") || null;

  const isVerifiedUser = !!(displayProfile as any)?.is_verified || !!(displayProfile as any)?.phone_verified;
  const isVerifiedSeller = !!(displayProfile as any)?.verified_seller;
  const viewerLga = (currentProfile as any)?.home_lga || (currentUser as any)?.user_metadata?.home_lga || null;

  return (
    <div className="pb-28 max-w-2xl lg:max-w-4xl min-[1440px]:max-w-7xl mx-auto px-yrdly-md pt-4 min-h-[100dvh] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body min-[1440px]:grid min-[1440px]:grid-cols-[minmax(0,1fr)_340px] min-[1440px]:gap-6 items-start">
      <div className="min-w-0">
        {/* ── Top Header ── */}
        <div className="flex items-center justify-between py-2 mb-4">
          {onBack ? (
            <button onClick={onBack} className="w-9 h-9 rounded-xl flex items-center justify-center border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)]">
              <ArrowLeft className="w-4 h-4 text-foreground" />
            </button>
          ) : <div className="w-9" />}

          <h1 className="text-base font-bold text-foreground font-yrdly-display">
            Profile
          </h1>

          {actualIsOwnProfile ? (
            <button
              onClick={() => router.push("/settings")}
              className="w-9 h-9 rounded-xl flex items-center justify-center border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] transition-colors hover:bg-white/5"
              title="Settings"
            >
              <Settings className="w-4 h-4 text-[var(--yrdly-label)]" />
            </button>
          ) : <div className="w-9" />}
        </div>

        {/* ── Identity Block (Mobile Parity + Desktop Redesign) ── */}
        <section className="mb-6">
          <div className="flex items-start gap-4 mb-4">
            {/* Avatar with Camera Icon Overlay */}
            <div className="relative flex-shrink-0">
              <div className="w-20 h-20 lg:w-28 lg:h-28 rounded-full overflow-hidden border-2 border-primary/30 bg-[var(--yrdly-glass-bg)] transition-all">
                <Avatar className="w-full h-full">
                  <AvatarImage src={avatarUrl || "/placeholder.svg"} className="object-cover" />
                  <AvatarFallback style={{ background: GREEN, color: "#000", fontSize: 24 }} className="font-yrdly-display font-extrabold">
                    {name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
              {actualIsOwnProfile && (
                <button
                  onClick={() => router.push("/settings/profile")}
                  className="absolute bottom-0 right-0 w-6 h-6 rounded-full flex items-center justify-center border-2 border-background"
                  style={{ background: GREEN }}
                  title="Edit Photo"
                >
                  <Camera className="w-3 h-3 text-black" />
                </button>
              )}
            </div>

            {/* Name & Handle & Desktop Inline Stats */}
            <div className="flex-1 min-w-0 pt-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <h2 className="text-xl lg:text-2xl font-bold text-foreground truncate font-yrdly-display">
                    {name}
                  </h2>
                  {isVerifiedUser && <VerifiedBadge size={16} />}
                </div>

                {/* Desktop Action Button */}
                <div className="hidden lg:block">
                  {actualIsOwnProfile ? (
                    <button
                      onClick={() => router.push("/settings/profile")}
                      className="h-9 px-5 rounded-full border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] text-xs font-semibold text-[var(--yrdly-label)] font-yrdly-body transition-colors hover:bg-white/5"
                    >
                      Edit Profile
                    </button>
                  ) : (
                    <button
                      onClick={handleToggleFollow}
                      disabled={followLoading}
                      className={`h-9 px-5 rounded-full text-xs font-bold font-yrdly-body transition-all flex items-center gap-1.5 ${
                        isFollowing
                          ? "bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground hover:bg-white/10"
                          : "bg-primary text-black hover:opacity-90"
                      } disabled:opacity-50`}
                    >
                      {isFollowing ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Following
                        </>
                      ) : (
                        "Follow"
                      )}
                    </button>
                  )}
                </div>
              </div>

              <p className="text-xs text-[var(--yrdly-label)] mt-0.5 font-yrdly-body">
                @{username}
              </p>

              {formattedLocation && (
                <div className="flex items-center gap-1 mt-1.5 text-xs text-[var(--yrdly-label)]">
                  <MapPin className="w-3 h-3 text-primary" />
                  <span className="truncate font-yrdly-body">{formattedLocation}</span>
                </div>
              )}

              {/* Inline Stats on Desktop */}
              <div className="hidden lg:flex items-center gap-6 mt-3 text-xs text-[var(--yrdly-label)] font-yrdly-body">
                <div>
                  <span className="font-extrabold text-foreground text-sm font-yrdly-display mr-1">
                    {userPosts.length}
                  </span>
                  posts
                </div>
                <button
                  onClick={() => router.push(`/network/${targetUser?.id}?mode=followers`)}
                  className="hover:opacity-80 transition-opacity"
                >
                  <span className="font-extrabold text-foreground text-sm font-yrdly-display mr-1">
                    {stats.followers.toLocaleString()}
                  </span>
                  followers
                </button>
                <button
                  onClick={() => router.push(`/network/${targetUser?.id}?mode=following`)}
                  className="hover:opacity-80 transition-opacity"
                >
                  <span className="font-extrabold text-foreground text-sm font-yrdly-display mr-1">
                    {stats.following.toLocaleString()}
                  </span>
                  following
                </button>
              </div>
            </div>
          </div>

          {/* Bio */}
          {bio && (
            <p className="text-sm text-foreground/90 leading-relaxed mb-4 font-yrdly-body">
              {bio}
            </p>
          )}

          {/* Mobile Action Button */}
          <div className="lg:hidden">
            {actualIsOwnProfile ? (
              <button
                onClick={() => router.push("/settings/profile")}
                className="h-9 px-5 rounded-full border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] text-xs font-semibold text-[var(--yrdly-label)] font-yrdly-body transition-colors hover:bg-white/5"
              >
                Edit Profile
              </button>
            ) : (
              <button
                onClick={handleToggleFollow}
                disabled={followLoading}
                className={`h-9 px-5 rounded-full text-xs font-bold font-yrdly-body transition-all flex items-center gap-1.5 ${
                  isFollowing
                    ? "bg-[var(--yrdly-glass-bg)] border border-[var(--yrdly-glass-border)] text-foreground hover:bg-white/10"
                    : "bg-primary text-black hover:opacity-90"
                } disabled:opacity-50`}
              >
                {isFollowing ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Following
                  </>
                ) : (
                  "Follow"
                )}
              </button>
            )}
          </div>
        </section>

        {/* ── Stats Bar (3-Column, hidden on lg+) ── */}
        <div className="flex lg:hidden items-center justify-between py-4 mb-6 border-y border-[var(--yrdly-glass-border)]">
          <div className="flex-1 text-center">
            <p className="text-xl font-extrabold text-foreground font-yrdly-display">
              {userPosts.length}
            </p>
            <p className="text-xs text-[var(--yrdly-label)] mt-0.5 font-yrdly-body">
              Posts
            </p>
          </div>
          <div className="w-[1px] h-8 bg-[var(--yrdly-glass-border)]" />
          <button
            className="flex-1 text-center transition-opacity hover:opacity-80"
            onClick={() => router.push(`/network/${targetUser?.id}?mode=followers`)}
          >
            <p className="text-xl font-extrabold text-foreground font-yrdly-display">
              {stats.followers.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--yrdly-label)] mt-0.5 font-yrdly-body">
              Followers
            </p>
          </button>
          <div className="w-[1px] h-8 bg-[var(--yrdly-glass-border)]" />
          <button
            className="flex-1 text-center transition-opacity hover:opacity-80"
            onClick={() => router.push(`/network/${targetUser?.id}?mode=following`)}
          >
            <p className="text-xl font-extrabold text-foreground font-yrdly-display">
              {stats.following.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--yrdly-label)] mt-0.5 font-yrdly-body">
              Following
            </p>
          </button>
        </div>

        {/* ── Quick Access (hidden on min-[1440px] where RightRail has it) ── */}
        {actualIsOwnProfile && (
          <div className="mb-6 min-[1440px]:hidden">
            <ProfileQuickAccess
              hasBusiness={hasBusiness}
              onOpenStore={() => {
                if (hasBusiness && userBusinessId) {
                  router.push(`/businesses/${userBusinessId}`);
                } else if (hasBusiness) {
                  router.push('/businesses');
                } else {
                  setIsCreateBusinessOpen(true);
                }
              }}
            />
            <CreateBusinessDialog open={isCreateBusinessOpen} onOpenChange={setIsCreateBusinessOpen} />
          </div>
        )}

        {/* ── Tabs ── */}
        <TabBar active={activeTab} onChange={setActiveTab} />

        <div className="mt-5">
          {/* Posts tab (Media Posts) */}
          {activeTab === "posts" && (
            mediaPosts.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
                {mediaPosts.map((post: Post) => (
                  <ProfilePostGridItem
                    key={post.id}
                    post={post}
                    onPress={() => router.push(`/posts/${post.id}`)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-[var(--yrdly-label)] font-yrdly-body">
                No media posts yet
              </div>
            )
          )}

          {/* Texts tab (Text-only Posts) */}
          {activeTab === "texts" && (
            textPosts.length > 0 ? (
              <div className="space-y-3">
                {textPosts.map((post: Post) => (
                  <GlassCard
                    key={post.id}
                    className="p-4 rounded-[11px] cursor-pointer"
                    onClick={() => router.push(`/posts/${post.id}`)}
                  >
                    <p className="text-foreground text-sm font-medium line-clamp-4 font-yrdly-body">{post.text}</p>
                    <div className="flex items-center justify-between mt-3 text-xs text-[var(--yrdly-label)] font-yrdly-body">
                      <span className="text-[0.65rem] font-bold uppercase tracking-wider font-yrdly-display">{post.category || "General"}</span>
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{post.liked_by?.length || 0}</span>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-[var(--yrdly-label)] font-yrdly-body">
                No text posts yet
              </div>
            )
          )}

          {/* Saved tab */}
          {activeTab === "saved" && (
            loadingSaved ? (
              <div className="p-4 text-center text-xs text-[var(--yrdly-label)] font-yrdly-body">Loading saved bookmarks...</div>
            ) : savedPosts.length > 0 ? (
              <div className="space-y-3">
                {savedPosts.map((item) => (
                  <MiniCard
                    key={item.id}
                    title={item.title || item.text || "Saved Item"}
                    sub={item.category || "Bookmark"}
                    img={item.image_url || item.image_urls?.[0] || null}
                    badge={item.category || "Saved"}
                    onClick={() => {
                      if (item.event_link) {
                        router.push(item.event_link);
                      } else {
                        router.push(`/posts/${item.id}`);
                      }
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-[var(--yrdly-label)] font-yrdly-body">
                No saved items yet
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Desktop Right Rail (1440px+) ── */}
      <div className="hidden min-[1440px]:block">
        <RightRail
          hasBusiness={hasBusiness}
          userBusinessId={userBusinessId}
          onOpenStore={() => {
            if (hasBusiness && userBusinessId) {
              router.push(`/businesses/${userBusinessId}`);
            } else if (hasBusiness) {
              router.push('/businesses');
            } else {
              setIsCreateBusinessOpen(true);
            }
          }}
          isOwnProfile={actualIsOwnProfile}
          viewerLga={viewerLga}
          viewerId={currentUser?.id}
          profileUserId={targetUser?.id}
        />
      </div>
    </div>
  );
}