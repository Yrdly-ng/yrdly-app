
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
import { X, Paperclip, Loader2, VideoIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import Image from "next/image";

// ── Design tokens ──────────────────────────────────────────────
const BG       = "var(--c-bg)";
const BORDER   = "rgba(187,187,187,0.3)";
const GREEN    = "#388E3C";
const FONT_RL  = "Inter, sans-serif";

// ── Schema ─────────────────────────────────────────────────────
const BlobImage = memo(({ file, className, alt }: { file: File, className?: string, alt?: string }) => {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt || ""} className={className} />;
});
BlobImage.displayName = "BlobImage";

const getFormSchema = (hasExistingImages: boolean) =>
  z.object({
    text:       z.string().min(1, "Text can't be empty.").max(500),
    imageFiles: z.any().optional(),
    category:   z.enum(["General", "Event", "For Sale", "Business"]).default("General"),
  }).superRefine((data, ctx) => {
    const isSpecialCategory = data.category === "Event" || data.category === "For Sale";
    const hasNewImages = data.imageFiles && data.imageFiles.length > 0;
    
    if (isSpecialCategory && !hasNewImages && !hasExistingImages) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageFiles"],
        message: `An image is required for ${data.category} posts.`,
      });
    }
  });


// ── Location pin icon (SVG matching Figma) ─────────────────────
const LocationIcon = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M11 2C7.686 2 5 4.686 5 8c0 4.5 6 12 6 12s6-7.5 6-12c0-3.314-2.686-6-6-6zm0 8.5A2.5 2.5 0 1 1 11 5.5a2.5 2.5 0 0 1 0 5z"
      stroke={GREEN}
      strokeWidth="1.3"
      fill="none"
    />
  </svg>
);

// ── Types ──────────────────────────────────────────────────────
type CreatePostDialogProps = {
  children?:     React.ReactNode;
  postToEdit?:   Post;
  onOpenChange?: (open: boolean) => void;
  createPost:    (postData: any, postId?: string, imageFiles?: FileList, videoFile?: File) => Promise<void>;
  open?:         boolean;
};

// ── Inner form content (shared between Dialog and Sheet) ───────
function PostForm({
  form,
  loading,
  onSubmit,
  onClose,
  isEditMode,
  fileInputRef,
  videoInputRef,
  videoFile,
  setVideoFile,
}: {
  form: any;
  loading: boolean;
  onSubmit: (v: any) => void;
  onClose: () => void;
  isEditMode: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  videoInputRef: React.RefObject<HTMLInputElement | null>;
  videoFile: File | null;
  setVideoFile: (f: File | null) => void;
}) {
  const text = form.watch("text") as string;
  const { toast } = useToast();
  const [fetchingLocation, setFetchingLocation] = React.useState(false);
  const [videoDuration, setVideoDuration] = React.useState<string | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = React.useState<string | null>(null);

  // Keep object URL in sync with videoFile
  React.useEffect(() => {
    if (!videoFile) { setVideoPreviewUrl(null); setVideoDuration(null); return; }
    const url = URL.createObjectURL(videoFile);
    setVideoPreviewUrl(url);
    // Read duration
    const v = document.createElement('video');
    v.src = url;
    v.preload = 'metadata';
    v.addEventListener('loadedmetadata', () => {
      const d = v.duration;
      const m = Math.floor(d / 60);
      const s = Math.floor(d % 60);
      setVideoDuration(`${m}:${String(s).padStart(2, '0')}`);
    });
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Inline validation
    const MAX = 15 * 1024 * 1024;
    const ALLOWED = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!ALLOWED.includes(file.type)) {
      toast({ variant: 'destructive', title: 'Unsupported format', description: 'Only MP4, WebM, and MOV videos are supported.' });
      return;
    }
    if (file.size > MAX) {
      toast({ variant: 'destructive', title: 'Video too large', description: 'Video must be under 15 MB. Try trimming or compressing it first.' });
      return;
    }
    setVideoFile(file);
    if (videoInputRef.current) videoInputRef.current.value = '';
  };


  const handleLocation = async () => {
    if (!navigator.geolocation) {
      toast({ title: "Location not supported", description: "Your browser doesn't support geolocation.", variant: "destructive" });
      return;
    }
    setFetchingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude } = position.coords;
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': 'en' } }
          );
          const data = await res.json();
          const locationText = data.display_name
            ? `📍 ${data.display_name.split(',').slice(0, 3).join(',').trim()}`
            : `📍 ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
          const currentText = form.getValues('text') || '';
          const separator = currentText && !currentText.endsWith('\n') ? '\n' : '';
          form.setValue('text', `${currentText}${separator}${locationText}`, { shouldDirty: true });
        } catch {
          toast({ title: "Location error", description: "Could not fetch your address. Please try again.", variant: "destructive" });
        } finally {
          setFetchingLocation(false);
        }
      },
      (err) => {
        setFetchingLocation(false);
        const msg = err.code === 1
          ? "Location access denied. Please allow location in your browser settings."
          : "Could not get your location. Please try again.";
        toast({ title: "Location unavailable", description: msg, variant: "destructive" });
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col" style={{ minHeight: 0, flex: 1 }}>
      {/* ── Top close button ── */}
      <div className="flex items-center justify-end px-3 pt-3 pb-1 flex-shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="w-5 h-5 flex items-center justify-center text-foreground hover:opacity-70 transition-opacity"
          aria-label="Close"
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      {/* ── Scrollable body: textarea + image previews ── */}
      {/* maxHeight on this section ensures the Post button is never pushed off-screen */}
      <div className="px-5 pb-2 flex flex-col overflow-y-auto" style={{ maxHeight: "340px", minHeight: 0 }}>
        <textarea
          {...form.register("text")}
          placeholder="What's going on?"
          rows={4}
          className={cn(
            "w-full bg-transparent resize-none outline-none border-none flex-shrink-0",
            "text-foreground placeholder:text-foreground text-[1rem] leading-[18px]",
          )}
          style={{ fontFamily: FONT_RL, fontWeight: 400 }}
          autoFocus
        />
        {form.formState.errors.text && (
          <p className="text-red-400 text-xs mt-1">
            {form.formState.errors.text.message as string}
          </p>
        )}
        {form.formState.errors.imageFiles && (
          <p className="text-red-400 text-xs mt-1">
            {form.formState.errors.imageFiles.message as string}
          </p>
        )}
        
        {/* ── Image Previews ── */}
        {form.watch("imageFiles")?.length > 0 && (
          <div className="flex gap-2 flex-wrap py-2 mt-2">
            {Array.from(form.watch("imageFiles") as FileList).map((file, i) => (
              <div key={i} className="relative w-20 h-20 flex-shrink-0 rounded-md overflow-hidden">
                <BlobImage 
                  file={file} 
                  alt="Preview" 
                  className="object-cover w-full h-full" 
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const dt = new DataTransfer();
                    const currentFiles = form.getValues("imageFiles") as FileList;
                    for (let j = 0; j < currentFiles.length; j++) {
                      if (j !== i) dt.items.add(currentFiles[j]);
                    }
                    form.setValue("imageFiles", dt.files, { shouldDirty: true });
                    if (fileInputRef.current) {
                      fileInputRef.current.files = dt.files;
                    }
                  }}
                  className="absolute top-1 right-1 bg-black/60 rounded-full p-1 hover:bg-black"
                >
                  <X size={12} color="white" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Video Preview ── */}
        {videoFile && videoPreviewUrl && (
          <div className="relative mt-2 rounded-xl overflow-hidden bg-black">
            <video
              src={videoPreviewUrl}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-48 object-contain"
            />
            {videoDuration && (
              <span
                className="absolute bottom-2 left-2 text-[0.625rem] font-bold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(0,0,0,0.65)', color: '#fff', fontFamily: FONT_RL }}
              >
                {videoDuration}
              </span>
            )}
            <button
              type="button"
              onClick={() => { setVideoFile(null); }}
              className="absolute top-2 right-2 bg-black/60 rounded-full p-1 hover:bg-black"
            >
              <X size={12} color="white" />
            </button>
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div className="mx-5 flex-shrink-0" style={{ borderTop: "0.2px solid var(--c-border)" }} />

      {/* ── Bottom toolbar — always visible, pinned ── */}
      <div className="flex items-center justify-between px-5 py-3 flex-shrink-0">
        {/* Left icons */}
        <div className="flex items-center gap-4">
          {/* Paperclip / photos */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="hover:opacity-70 transition-opacity"
            aria-label="Attach image"
          >
            <Paperclip size={22} color={GREEN} strokeWidth={2} />
          </button>
          {/* Hidden image input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => form.setValue("imageFiles", e.target.files)}
          />

          {/* Video */}
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="hover:opacity-70 transition-opacity"
            aria-label="Attach video"
          >
            <VideoIcon size={22} color={GREEN} strokeWidth={2} />
          </button>
          {/* Hidden video input */}
          <input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={handleVideoSelect}
          />


          {/* Location */}
          <button
            type="button"
            onClick={handleLocation}
            disabled={fetchingLocation}
            className="hover:opacity-70 transition-opacity disabled:opacity-50"
            aria-label="Add location"
          >
            {fetchingLocation
              ? <Loader2 size={22} color={GREEN} strokeWidth={2} className="animate-spin" />
              : <LocationIcon />}
          </button>
        </div>

        {/* Post button */}
        <button
          type="submit"
          disabled={loading || !text?.trim()}
          className="h-[37px] px-8 rounded-full text-foreground text-[0.875rem] font-medium transition-opacity disabled:opacity-50 hover:opacity-90"
          style={{ background: GREEN, fontFamily: FONT_RL }}
        >
          {loading
            ? isEditMode ? "Saving…" : "Posting…"
            : isEditMode ? "Save" : "Post"}
        </button>
      </div>
    </form>
  );
}

// ── Main component ─────────────────────────────────────────────
const CreatePostDialogComponent = ({
  children,
  postToEdit,
  onOpenChange,
  createPost,
  open: externalOpen,
}: CreatePostDialogProps) => {
  const { user } = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [videoFile, setVideoFile]       = useState<File | null>(null);
  const isMobile    = useIsMobile();
  const isEditMode  = !!postToEdit;
  const fileInputRef  = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  const open = externalOpen !== undefined ? externalOpen : internalOpen;

  const hasExistingImages = !!postToEdit?.image_urls?.length;
  const formSchema = useMemo(() => getFormSchema(hasExistingImages), [hasExistingImages]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { text: "", imageFiles: undefined, category: "General" as const },
  });

  const stableReset = useCallback((v: any) => form.reset(v), [form]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (isEditMode && postToEdit) {
        stableReset({ text: postToEdit.text, imageFiles: undefined, category: postToEdit.category || "General" });
      } else {
        stableReset({ text: "", imageFiles: undefined, category: "General" });
      }
    }, 0);
    return () => clearTimeout(t);
  }, [open, isEditMode, postToEdit, stableReset]);

  const handleOpenChange = useCallback((next: boolean) => {
    if (externalOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next) { form.reset(); setVideoFile(null); }
  }, [onOpenChange, externalOpen, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    const imageFiles = values.imageFiles?.length > 0 ? values.imageFiles : undefined;
    const postData   = { ...values, image_urls: isEditMode && postToEdit?.image_urls ? postToEdit.image_urls : undefined };
    await createPost(postData, postToEdit?.id, imageFiles, videoFile ?? undefined);
    setVideoFile(null);
    setLoading(false);
    handleOpenChange(false);
  }

  // Shared dialog inner styling
  const dialogStyles: React.CSSProperties = {
    background:   BG,
    border:       `0.2px solid ${BORDER}`,
    borderRadius: "11px",
    padding:      0,
    overflow:     "hidden",
    maxWidth:     "626px",
    width:        "100%",
  };

  const formProps = { form, loading, onSubmit, onClose: () => handleOpenChange(false), isEditMode, fileInputRef, videoInputRef, videoFile, setVideoFile };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>{children ?? <span />}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="p-0"
          style={{
            background: BG,
            border: `0.2px solid ${BORDER}`,
            borderTopLeftRadius: "11px",
            borderTopRightRadius: "11px",
            minHeight: "300px",
            maxHeight: "85vh",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
          }}
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
        style={dialogStyles}
        hideClose
      >
        <PostForm {...formProps} />
      </DialogContent>
    </Dialog>
  );
};

export const CreatePostDialog = memo(CreatePostDialogComponent);
