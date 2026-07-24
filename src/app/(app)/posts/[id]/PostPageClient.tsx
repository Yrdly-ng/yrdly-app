"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Post as PostType } from "@/types";
import { PostDetailView } from "@/components/PostDetailView";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "next/navigation";

export function PostPageClient({ postId }: { postId: string }) {
  const [post, setPost] = useState<PostType | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (!postId) {
      setLoading(false);
      return;
    }

    const channel = supabase
      .channel(`post_${postId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "posts", filter: `id=eq.${postId}` },
        (payload) => {
          if (payload.new) setPost((prev) => prev ? { ...prev, ...payload.new } as PostType : payload.new as PostType);
          else if (payload.eventType === "DELETE") router.push("/home");
          setLoading(false);
        }
      )
      .subscribe();

    const fetchPost = async () => {
      const { data, error } = await supabase
        .from("posts")
        .select(`*, user:users!posts_user_id_fkey(id, name, avatar_url)`)
        .eq("id", postId)
        .single();

      if (error || !data) {
        router.push("/home");
      } else {
        setPost({
          ...data,
          user: data.user,
          author_name: data.author_name ?? data.user?.name,
          author_image: data.author_image ?? data.user?.avatar_url,
        } as PostType);
      }
      setLoading(false);
    };

    fetchPost();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [postId, router]);

  if (loading) {
    return (
      <div className="w-full max-w-[626px] mx-auto px-3 py-4">
        <Skeleton className="h-[400px] w-full rounded-[11px] bg-card" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="max-w-[626px] mx-auto text-center py-10 px-4">
        <h1 className="text-xl font-bold text-foreground">Post not found</h1>
        <p className="text-muted-foreground text-sm mt-1">The post may have been deleted.</p>
      </div>
    );
  }

  return (
    <div className="w-full px-3 py-4 lg:py-6 pb-20 lg:pb-8">
      <PostDetailView post={post} />
    </div>
  );
}
