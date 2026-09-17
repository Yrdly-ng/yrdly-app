"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/use-supabase-auth";
import { usePosts } from "@/hooks/use-posts";
import { supabase } from "@/lib/supabase";
import { ModerationService } from "@/lib/moderation-service";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ImageIcon,
  Video,
  Globe,
  Users,
  X,
  Loader2,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export default function CreatePostPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { refreshPosts } = usePosts();

  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [posted, setPosted] = useState(false);
  const [moderationStatus, setModerationStatus] = useState<"approved" | "pending">("approved");

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Handle Image selection (max 10)
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);
    const available = 10 - imageFiles.length;
    if (available <= 0) {
      toast({
        variant: "destructive",
        title: "Limit Reached",
        description: "You can attach up to 10 photos.",
      });
      return;
    }
    const toAdd = selected.slice(0, available);
    setImageFiles((prev) => [...prev, ...toAdd]);
  };

  // Handle Video selection (max 3, 40MB limit each)
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);
    const available = 3 - videoFiles.length;
    if (available <= 0) {
      toast({
        variant: "destructive",
        title: "Limit Reached",
        description: "You can attach up to 3 videos.",
      });
      return;
    }

    const validVideos: File[] = [];
    for (const file of selected) {
      if (file.size > 40 * 1024 * 1024) {
        toast({
          variant: "destructive",
          title: "File Too Large",
          description: `Video "${file.name}" exceeds the 40MB limit.`,
        });
      } else {
        validVideos.push(file);
      }
    }

    const toAdd = validVideos.slice(0, available);
    setVideoFiles((prev) => [...prev, ...toAdd]);
  };

  const removeImage = (index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const removeVideo = (index: number) => {
    setVideoFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!user) {
      toast({
        variant: "destructive",
        title: "Authentication Error",
        description: "You must be signed in to create a post.",
      });
      return;
    }

    if (!text.trim() && imageFiles.length === 0 && videoFiles.length === 0) {
      toast({
        variant: "destructive",
        title: "Empty Post",
        description: "Please enter text or attach media.",
      });
      return;
    }

    setPosting(true);
    setUploadProgress(10);

    try {
      // 1. Upload Images to Supabase Storage 'post-images' bucket
      const uploadedImageUrls: string[] = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        const safeName = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
        const path = `${user.id}/${Date.now()}_${i}_${safeName}`;

        const { error: uploadErr } = await supabase.storage
          .from("post-images")
          .upload(path, file, { contentType: file.type || "image/jpeg", cacheControl: "604800", upsert: false });

        if (uploadErr) throw uploadErr;

        const { data: pubData } = supabase.storage
          .from("post-images")
          .getPublicUrl(path);

        if (pubData?.publicUrl) {
          uploadedImageUrls.push(pubData.publicUrl);
        }
        setUploadProgress(10 + Math.round(((i + 1) / (imageFiles.length + videoFiles.length || 1)) * 40));
      }

      // 2. Upload Videos to Supabase Storage 'post-videos' bucket
      const uploadedVideoUrls: string[] = [];
      for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        const safeName = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
        const path = `${user.id}/${Date.now()}_${i}_${safeName}`;

        const { error: uploadErr } = await supabase.storage
          .from("post-videos")
          .upload(path, file, { contentType: file.type || "video/mp4", cacheControl: "604800", upsert: false });

        if (uploadErr) throw uploadErr;

        const { data: pubData } = supabase.storage
          .from("post-videos")
          .getPublicUrl(path);

        if (pubData?.publicUrl) {
          uploadedVideoUrls.push(pubData.publicUrl);
        }
        setUploadProgress(50 + Math.round(((i + 1) / videoFiles.length) * 40));
      }

      setUploadProgress(95);

      // 3. Moderation Check & Create post record (category strictly locked to "General")
      const trimmedText = text.trim();
      let modStatus: "approved" | "pending" = "approved";
      let modReason = "";

      if (trimmedText) {
        const textMod = await ModerationService.checkText(trimmedText);
        if (!textMod.isSafe) {
          modStatus = "pending";
          modReason = textMod.reason || "Flagged text content";
        }
      }

      const postPayload: Record<string, any> = {
        user_id: user.id,
        author_name: profile?.name || user.email?.split("@")[0] || "Neighbor",
        author_image: profile?.avatar_url || "",
        text: trimmedText,
        category: "General",
        visibility,
        image_urls: uploadedImageUrls,
        comment_count: 0,
        liked_by: [],
        moderation_status: modStatus,
        state: profile?.home_state || null,
        lga: profile?.home_lga || null,
        ward: profile?.home_ward || null,
        author_location: {
          state: profile?.home_state || null,
          lga: profile?.home_lga || null,
          ward: profile?.home_ward || null,
        },
        created_at: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      };

      if (uploadedVideoUrls.length > 0) {
        postPayload.video_urls = uploadedVideoUrls;
      }

      const { data: newPost, error: insertErr } = await supabase
        .from("posts")
        .insert(postPayload)
        .select()
        .single();

      if (insertErr) throw insertErr;

      if (modStatus === "pending" && newPost) {
        await supabase.from("moderation_queue").insert({
          content_id: newPost.id,
          table_name: "posts",
          user_id: user.id,
          status: "pending",
          reason: modReason,
          text_content: trimmedText,
          image_urls: uploadedImageUrls,
        });
      }

      setPosting(false);
      setUploadProgress(100);
      
      setModerationStatus(modStatus);
      setPosted(true);

      if (refreshPosts) {
        refreshPosts();
      }
    } catch (err: any) {
      setPosting(false);
      setUploadProgress(0);
      console.error("Failed to create post:", err);
      toast({
        variant: "destructive",
        title: "Posting Error",
        description: err?.message || "Failed to create post. Please try again.",
      });
    }
  };

  const hasContent = text.trim().length > 0 || imageFiles.length > 0 || videoFiles.length > 0;

  // ── Success State Screen ──────────────────────────────────────────
  if (posted) {
    if (moderationStatus === "pending") {
      return (
        <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold font-sans text-foreground mb-2">
            Sent for Moderation
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            Your post was flagged and has been sent for admin review. It will appear on the feed once approved.
          </p>
          <Button
            onClick={() => router.push("/home")}
            className="rounded-full px-8 bg-primary text-foreground font-sans font-bold hover:bg-primary/90"
          >
            Back to Feed
          </Button>
        </div>
      );
    }

    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>
        <h1 className="text-2xl font-bold font-sans text-foreground mb-2">
          Post Published!
        </h1>
        <p className="text-sm text-muted-foreground mb-6">
          Your post is now live and visible to your neighborhood community.
        </p>
        <Button
          onClick={() => router.push("/home")}
          className="rounded-full px-8 bg-primary text-foreground font-sans font-bold hover:bg-primary/90"
        >
          View Feed
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      <div className="max-w-2xl mx-auto border-x border-border min-h-screen bg-card">
        {/* Header */}
        <div className="sticky top-0 z-30 bg-card/95 backdrop-blur border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="rounded-full hover:bg-secondary"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-bold font-sans text-foreground">
              Create Post
            </h1>
          </div>

          <Button
            disabled={!hasContent || posting}
            onClick={handleSubmit}
            className="rounded-full px-6 bg-primary text-foreground font-sans font-bold hover:bg-primary/90 disabled:opacity-50"
          >
            {posting ? (
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {uploadProgress > 0 && (
                  <span className="text-xs">{uploadProgress}%</span>
                )}
              </div>
            ) : (
              "Post"
            )}
          </Button>
        </div>

        {/* Upload Progress Bar */}
        {posting && (
          <div className="w-full bg-secondary h-1">
            <div
              className="bg-primary h-1 transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        )}

        {/* Composer Area */}
        <div className="p-4 sm:p-6 space-y-4">
          {/* User Info & Visibility Bar */}
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 rounded-full overflow-hidden border border-border bg-secondary flex-shrink-0">
              {profile?.avatar_url ? (
                <Image
                  src={profile.avatar_url}
                  alt={profile.name || "User"}
                  fill
                  className="object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-bold text-muted-foreground">
                  {profile?.name?.[0]?.toUpperCase() || "U"}
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold font-sans text-foreground truncate">
                {profile?.name || "Neighbor"}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {/* Visibility Toggle */}
                <button
                  type="button"
                  onClick={() => setVisibility((v) => (v === "public" ? "private" : "public"))}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
                >
                  {visibility === "public" ? (
                    <>
                      <Globe className="w-3 h-3 text-primary" />
                      <span>Public</span>
                    </>
                  ) : (
                    <>
                      <Users className="w-3 h-3 text-amber-500" />
                      <span>Friends Only</span>
                    </>
                  )}
                </button>

                {/* Category Badge (Locked to General) */}
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                  General
                </span>
              </div>
            </div>
          </div>

          {/* Main Text Input */}
          <Textarea
            placeholder="What's happening in your neighbourhood?"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            rows={5}
            className="w-full bg-transparent border-0 focus-visible:ring-0 text-base sm:text-lg resize-none p-0 placeholder:text-muted-foreground/60"
          />

          {/* Media Previews */}
          {/* Images Grid */}
          {imageFiles.length > 0 && (
            <div className="space-y-1.5 pt-2">
              <p className="text-xs text-muted-foreground font-medium">
                Photos ({imageFiles.length}/10)
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {imageFiles.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="relative aspect-square rounded-2xl overflow-hidden border border-border bg-secondary group"
                  >
                    <Image
                      src={URL.createObjectURL(file)}
                      alt={`Upload ${i + 1}`}
                      fill
                      className="object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Videos List */}
          {videoFiles.length > 0 && (
            <div className="space-y-1.5 pt-2">
              <p className="text-xs text-muted-foreground font-medium">
                Videos ({videoFiles.length}/3)
              </p>
              <div className="space-y-2">
                {videoFiles.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="flex items-center justify-between p-3 rounded-2xl border border-border bg-secondary/50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Video className="w-5 h-5 text-primary shrink-0" />
                      <span className="text-xs font-medium text-foreground truncate">
                        {file.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        ({(file.size / (1024 * 1024)).toFixed(1)}MB)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeVideo(i)}
                      className="p-1 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Media Toolbar Footer */}
        <div className="border-t border-border p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Add Images */}
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={imageFiles.length >= 10 || posting}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold bg-secondary hover:bg-secondary/80 text-foreground transition-colors disabled:opacity-40"
            >
              <ImageIcon className="w-4 h-4 text-emerald-500" />
              <span>Photo</span>
              {imageFiles.length > 0 && (
                <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                  {imageFiles.length}
                </span>
              )}
            </button>

            {/* Add Videos */}
            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={videoFiles.length >= 3 || posting}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-full text-xs font-semibold bg-secondary hover:bg-secondary/80 text-foreground transition-colors disabled:opacity-40"
            >
              <Video className="w-4 h-4 text-blue-500" />
              <span>Video</span>
              {videoFiles.length > 0 && (
                <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                  {videoFiles.length}
                </span>
              )}
            </button>
          </div>

          <p className="text-[11px] text-muted-foreground hidden sm:block">
            Max 10 photos • 3 videos (40MB)
          </p>

          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageSelect}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={handleVideoSelect}
          />
        </div>
      </div>
    </div>
  );
}
