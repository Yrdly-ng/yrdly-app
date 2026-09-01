"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Bookmark } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { PostCard } from "@/components/PostCard";
import { Skeleton } from "@/components/ui/skeleton";
import type { Post } from "@/types";

const FONT = "var(--font-work-sans)";

export default function BookmarksPage() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchBookmarks = async () => {
      try {
        const { data, error } = await supabase
          .from("post_bookmarks")
          .select("created_at, posts(*)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) throw error;

        const bookmarkedPosts = (data || [])
          .map((row: any) => row.posts)
          .filter(Boolean) as Post[];

        setPosts(bookmarkedPosts);
      } catch (error) {
        console.error("Error fetching bookmarks:", error);
        setPosts([]);
      } finally {
        setLoading(false);
      }
    };

    fetchBookmarks();
  }, [user]);

  return (
    <div className="pb-6">
      {/* Header */}
      <div className="pt-1 pb-4">
        <h1 className="text-3xl text-foreground leading-tight" style={{ fontFamily: FONT, fontWeight: 700 }}>
          Saved Posts
        </h1>
        <p className="text-sm" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
          Posts you bookmarked from the feed
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72 w-full rounded-[1.5rem]" style={{ background: "var(--c-card)" }} />
          ))}
        </div>
      ) : posts.length > 0 ? (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center px-6">
          <Bookmark size={48} weight="light" className="text-[var(--c-text-muted)] mb-4" />
          <h2 className="text-lg font-semibold text-foreground mb-1" style={{ fontFamily: FONT }}>
            No saved posts yet
          </h2>
          <p className="text-sm text-[var(--c-text-muted)] max-w-xs mb-5" style={{ fontFamily: FONT }}>
            Tap the bookmark icon on any post to save it here for later.
          </p>
          <Link
            href="/home"
            className="h-11 px-6 inline-flex items-center rounded-full text-sm font-bold text-foreground transition-all active:scale-95"
            style={{ background: "hsl(var(--primary))", fontFamily: FONT }}
          >
            Back to Feed
          </Link>
        </div>
      )}
    </div>
  );
}
