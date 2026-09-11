"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useState, useEffect, memo, useCallback, useMemo, useRef } from "react";
import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Post } from "@/types";
import { X, Camera, Image as ImageIcon, Globe, Lock, ChevronDown, Send, Plus, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";
import { LocationInput } from "./LocationInput";

// ── Design tokens ──────────────────────────────────────────────
const GREEN = "#82DB7E";

const POST_CATEGORIES = ["General", "Event", "For Sale", "Business"];

const BlobImage = memo(({ file, className, alt }: { file: File; className?: string; alt?: string }) => {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!url) return null;
  return <Image src={url} alt={alt || ""} fill className={className} unoptimized />;
});
BlobImage.displayName = "BlobImage";

const getFormSchema = (hasExistingImages: boolean) =>
  z.object({
    text: z.string().min(1, "Text can't be empty.").max(2000),
    imageFiles: z.any().optional(),
    category: z.enum(["General", "Event", "For Sale", "Business"]).default("General"),
    visibility: z.enum(["public", "private"]).default("public"),
    location: z.any().optional(),
  });

type CreatePostDialogProps = {
  children?: React.ReactNode;
  postToEdit?: Post;
  onOpenChange?: (open: boolean) => void;
  createPost: (postData: any, postId?: string, imageFiles?: FileList, videoFile?: File) => Promise<void>;
  open?: boolean;
};

function PostForm({
  form,
  loading,
  onSubmit,
  onClose,
  isEditMode,
  fileInputRef,
  profile,
}: {
  form: any;
  loading: boolean;
  onSubmit: (v: any) => void;
  onClose: () => void;
  isEditMode: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  profile: any;
}) {
  const text = form.watch("text") as string || "";
  const visibility = form.watch("visibility") as "public" | "private" || "public";
  const category = form.watch("category") as string || "General";
  const imageFiles = form.watch("imageFiles") as FileList | undefined;

  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showLocationInput, setShowLocationInput] = useState(false);

  const locationLabel = profile?.home_lga || profile?.home_ward
    ? [profile.home_ward, profile.home_lga].filter(Boolean).join(", ")
    : profile?.location
    ? [profile.location.ward, profile.location.lga].filter(Boolean).join(", ")
    : "";

  const canPost = (text.trim().length > 0 || (imageFiles && imageFiles.length > 0)) && !loading;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col p-4 sm:p-6 text-foreground font-yrdly-body max-h-[85vh] overflow-y-auto"
    >
      {/* ── Top close button ── */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold font-yrdly-display">
          {isEditMode ? "Edit Post" : "Create Post"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-surface border border-[var(--yrdly-glass-border)] flex items-center justify-center text-foreground hover:opacity-70 transition-opacity"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Profile row ── */}
      <div className="flex items-start gap-3 mb-4">
        <div className="relative flex-shrink-0">
          {profile?.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt={profile?.name || "Avatar"}
              width={48}
              height={48}
              className="w-12 h-12 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center font-extrabold text-lg text-black"
              style={{ backgroundColor: GREEN }}
            >
              {(profile?.name || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 rounded-full flex items-center justify-center text-black"
            style={{ backgroundColor: GREEN }}
          >
            <Camera size={9} strokeWidth={3} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-base text-foreground truncate">
              {profile?.name || "You"}
            </span>

            {/* Category pill dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowCategoryMenu((v) => !v)}
                className="flex items-center gap-1 rounded-full px-2.5 py-1 border text-xs font-extrabold transition-colors"
                style={{
                  backgroundColor: "rgba(130,219,126,0.12)",
                  borderColor: "rgba(130,219,126,0.4)",
                  color: GREEN,
                }}
              >
                <span>{category}</span>
                <ChevronDown size={12} />
              </button>

              {showCategoryMenu && (
                <div className="absolute top-8 left-0 w-36 rounded-xl border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)] shadow-xl z-50 py-1">
                  {POST_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        form.setValue("category", cat);
                        setShowCategoryMenu(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors",
                        category === cat ? "text-[#82DB7E] font-bold" : "text-foreground"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-[var(--yrdly-label)]">
            {locationLabel && <span>{locationLabel}</span>}
            {locationLabel && <span>·</span>}
            {visibility === "private" ? (
              <Lock size={11} className="text-[#82DB7E]" />
            ) : (
              <Globe size={11} className="text-[#82DB7E]" />
            )}
            <span className="text-[#82DB7E] font-medium">
              {visibility === "private" ? "Private" : "Public"}
            </span>
          </div>
        </div>
      </div>

      {/* ── Composer card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <textarea
          {...form.register("text")}
          placeholder="What's happening nearby?"
          rows={5}
          maxLength={2000}
          className="w-full bg-transparent resize-none outline-none border-none text-foreground placeholder:text-[var(--yrdly-label)] text-lg leading-relaxed"
          autoFocus
        />
        <div className="flex items-center justify-between border-t border-[var(--yrdly-glass-border)] pt-2 mt-2">
          <button
            type="button"
            onClick={() => setShowLocationInput((v) => !v)}
            className="text-xs text-[var(--yrdly-label)] hover:text-foreground transition-colors"
          >
            {showLocationInput ? "Hide location search" : "📍 Tag location"}
          </button>
          <span className="text-xs text-[var(--yrdly-label)] font-mono">
            {text.length}/2000
          </span>
        </div>
        {showLocationInput && (
          <div className="mt-3">
            <LocationInput name="location" control={form.control} />
          </div>
        )}
      </div>

      {/* ── Media toolbar card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-3 py-2 rounded-xl border border-dashed transition-colors"
          style={{
            borderColor: "rgba(130,219,126,0.4)",
            backgroundColor: "rgba(130,219,126,0.08)",
          }}
        >
          <div
            className="w-12 h-12 rounded-xl border flex items-center justify-center"
            style={{ borderColor: GREEN, backgroundColor: "rgba(130,219,126,0.15)" }}
          >
            <ImageIcon size={22} style={{ color: GREEN }} />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold" style={{ color: GREEN }}>Add Photo</p>
            <p className="text-xs text-[var(--yrdly-label)]">Upload images for your post</p>
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            form.setValue("imageFiles", files, { shouldDirty: true, shouldValidate: true });
          }}
        />
      </div>

      {/* ── Image previews ── */}
      {imageFiles && imageFiles.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3">
          {Array.from(imageFiles).map((file, i) => (
            <div key={i} className="relative w-24 h-24 flex-shrink-0 rounded-xl overflow-hidden border border-[var(--yrdly-glass-border)]">
              <BlobImage file={file} alt="Preview" className="object-cover w-full h-full" />
              <button
                type="button"
                onClick={() => {
                  const dt = new DataTransfer();
                  for (let j = 0; j < imageFiles.length; j++) {
                    if (j !== i) dt.items.add(imageFiles[j]);
                  }
                  form.setValue("imageFiles", dt.files.length > 0 ? dt.files : undefined, { shouldDirty: true });
                }}
                className="absolute top-1 right-1 bg-black/70 rounded-full p-1 text-white hover:bg-black"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-24 h-24 rounded-xl border border-dashed border-[var(--yrdly-glass-border)] flex flex-col items-center justify-center gap-1 text-[var(--yrdly-label)] hover:text-foreground flex-shrink-0"
          >
            <Plus size={20} />
            <span className="text-xs font-semibold">Add more</span>
          </button>
        </div>
      )}

      {/* ── Visibility row card ── */}
      <button
        type="button"
        onClick={() => form.setValue("visibility", visibility === "private" ? "public" : "private")}
        className="w-full flex items-center justify-between rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-4 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full border flex items-center justify-center"
            style={{ borderColor: GREEN }}
          >
            {visibility === "private" ? (
              <Lock size={18} style={{ color: GREEN }} />
            ) : (
              <Globe size={18} style={{ color: GREEN }} />
            )}
          </div>
          <div>
            <p className="text-sm font-bold text-foreground">Who can see this?</p>
            <p className="text-xs text-[var(--yrdly-label)]">
              {visibility === "private" ? "Only your friends" : "Anyone on Yrdly"}
            </p>
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 rounded-full px-3 py-1.5 border text-xs font-bold"
          style={{ borderColor: GREEN, color: GREEN }}
        >
          <span>{visibility === "private" ? "Private" : "Public"}</span>
          <Repeat size={12} />
        </div>
      </button>

      {/* ── Post button ── */}
      <button
        type="submit"
        disabled={!canPost}
        className="w-full py-4 rounded-full font-black text-base flex items-center justify-center gap-2.5 transition-all disabled:opacity-50"
        style={{
          backgroundColor: canPost ? GREEN : "rgba(130,219,126,0.4)",
          color: "#0B0D0B",
          boxShadow: canPost ? "0 6px 14px rgba(130,219,126,0.25)" : "none",
        }}
      >
        <Send size={18} />
        <span>{loading ? "Posting…" : "Post to Yrdly"}</span>
      </button>
    </form>
  );
}

const CreatePostDialogComponent = ({
  children,
  postToEdit,
  onOpenChange,
  createPost,
  open: externalOpen,
}: CreatePostDialogProps) => {
  const { user, profile } = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const isEditMode = !!postToEdit;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const open = externalOpen !== undefined ? externalOpen : internalOpen;

  const hasExistingImages = !!postToEdit?.image_urls?.length;
  const formSchema = useMemo(() => getFormSchema(hasExistingImages), [hasExistingImages]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { text: "", imageFiles: undefined, category: "General" as const, visibility: "public" as const },
  });

  const stableReset = useCallback((v: any) => form.reset(v), [form]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (isEditMode && postToEdit) {
        stableReset({
          text: postToEdit.text,
          imageFiles: undefined,
          category: (postToEdit.category as any) || "General",
          visibility: "public",
        });
      } else {
        stableReset({ text: "", imageFiles: undefined, category: "General", visibility: "public" });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [open, isEditMode, postToEdit, stableReset]);

  const handleOpenChange = useCallback((next: boolean) => {
    if (externalOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) form.reset();
  }, [onOpenChange, externalOpen, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    const imageFiles = values.imageFiles?.length > 0 ? values.imageFiles : undefined;
    const postData = {
      ...values,
      image_urls: isEditMode && postToEdit?.image_urls ? postToEdit.image_urls : undefined,
    };
    await createPost(postData, postToEdit?.id, imageFiles);
    setLoading(false);
    handleOpenChange(false);
  }

  const formProps = {
    form,
    loading,
    onSubmit,
    onClose: () => handleOpenChange(false),
    isEditMode,
    fileInputRef,
    profile,
  };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>{children ?? <span />}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="p-0 border-0 rounded-t-3xl bg-[var(--yrdly-dark)] max-h-[92dvh] overflow-y-auto"
          hideClose
        >
          <PostForm {...formProps} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {externalOpen === undefined && (
        <DialogTrigger asChild>{children ?? <span />}</DialogTrigger>
      )}
      <DialogContent
        className="p-0 border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)] rounded-3xl max-w-[600px] w-full overflow-hidden shadow-2xl"
        hideClose
      >
        <PostForm {...formProps} />
      </DialogContent>
    </Dialog>
  );
};

export const CreatePostDialog = memo(CreatePostDialogComponent);