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
import { X, Camera, ChevronDown, ChevronRight, Gem, PlusCircle, Grid, FileText, MapPin, ShieldCheck, Tag, XCircle, Plus, Check } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useState, useEffect, memo, useCallback, useMemo, useRef } from "react";
import * as React from "react";
import { usePosts } from "@/hooks/use-posts";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Post } from "@/types";
import Image from "next/image";
import { cn } from "@/lib/utils";

const GREEN = "#82DB7E";

export const MARKETPLACE_CATEGORIES = [
  "Electronics",
  "Fashion",
  "Vehicles",
  "Furniture",
  "Books",
  "Sports",
  "Food",
  "Services",
  "Real Estate",
  "Other",
];

export const ITEM_CONDITIONS = ["New", "Like New", "Good", "Used", "Refurbished"];

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

const getFormSchema = (isEditMode: boolean, existingImageCount: number) =>
  z.object({
    title: z.string().min(1, "Item title can't be empty.").max(80),
    description: z.string().min(1, "Item description is required.").max(1000),
    price: z.string().min(1, "Price is required."),
    subCategory: z.string().default("Electronics"),
    condition: z.string().default("New"),
    negotiable: z.boolean().default(false),
    imageFiles: z.any().optional(),
  });

type CreateItemDialogProps = {
  children?: React.ReactNode;
  postToEdit?: Post;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

interface FormBodyProps {
  form: ReturnType<typeof useForm<any>>;
  onSubmit: (values: any) => Promise<void>;
  loading: boolean;
  isEditMode: boolean;
  postToEdit?: Post;
  removedImageIndexes: number[];
  setRemovedImageIndexes: React.Dispatch<React.SetStateAction<number[]>>;
  onClose: () => void;
  profile: any;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

function FormBody({
  form,
  onSubmit,
  loading,
  isEditMode,
  postToEdit,
  removedImageIndexes,
  setRemovedImageIndexes,
  onClose,
  profile,
  fileInputRef,
}: FormBodyProps) {
  const title = form.watch("title") as string || "";
  const description = form.watch("description") as string || "";
  const price = form.watch("price") as string || "";
  const subCategory = form.watch("subCategory") as string || "Electronics";
  const condition = form.watch("condition") as string || "New";
  const negotiable = form.watch("negotiable") as boolean || false;
  const imageFiles = form.watch("imageFiles") as FileList | undefined;

  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showConditionDropdown, setShowConditionDropdown] = useState(false);

  const locationLabel = profile?.home_lga || profile?.home_state
    ? [profile.home_ward, profile.home_lga, profile.home_state].filter(Boolean).join(", ")
    : profile?.location
    ? [profile.location.ward, profile.location.lga, profile.location.state].filter(Boolean).join(", ")
    : "No location set";

  const totalImageCount = (imageFiles ? imageFiles.length : 0) + ((postToEdit?.image_urls?.length || 0) - removedImageIndexes.length);
  const canSubmit = title.trim().length > 0 && price.trim().length > 0 && totalImageCount > 0 && !loading;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col p-4 sm:p-6 text-foreground font-yrdly-body max-h-[85vh] overflow-y-auto"
    >
      {/* ── Top close button ── */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold font-yrdly-display">
          {isEditMode ? "Edit Listing" : "Sell an Item"}
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

      {/* ── Seller card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-3.5 mb-3 flex items-center gap-3">
        {profile?.avatar_url ? (
          <Image
            src={profile.avatar_url}
            alt={profile?.name || "Seller"}
            width={46}
            height={46}
            className="w-11 h-11 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center font-extrabold text-lg text-black flex-shrink-0"
            style={{ backgroundColor: GREEN }}
          >
            {(profile?.name || "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-base text-foreground truncate">
              {profile?.name || "You"}
            </span>
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
                <Tag size={10} />
                <span>For Sale</span>
                <ChevronDown size={10} />
              </button>
              {showCategoryMenu && (
                <div className="absolute top-8 left-0 w-36 rounded-xl border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)] shadow-xl z-50 py-1">
                  {MARKETPLACE_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        form.setValue("subCategory", cat);
                        setShowCategoryMenu(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-sm hover:bg-white/5 transition-colors",
                        subCategory === cat ? "text-[#82DB7E] font-bold" : "text-foreground"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-xs text-[var(--yrdly-label)] truncate mt-0.5">
            {locationLabel} · <span className="text-[#82DB7E]">Public</span>
          </p>
        </div>
      </div>

      {/* ── Photo gallery card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Camera size={16} style={{ color: GREEN }} />
            <span className="text-sm font-bold text-foreground">Add Photos</span>
            <span className="text-red-500 font-bold">*</span>
          </div>
          <span className="text-xs text-[var(--yrdly-label)]">Add up to 10 photos</span>
        </div>

        <div className="flex gap-2.5 overflow-x-auto pb-2">
          {/* Add photo button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-24 h-24 rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-1 flex-shrink-0 transition-colors"
            style={{ borderColor: GREEN, backgroundColor: "rgba(130,219,126,0.06)" }}
          >
            <Camera size={26} style={{ color: GREEN }} />
            <span className="text-xs font-bold" style={{ color: GREEN }}>Add Photo</span>
          </button>

          {/* Uploaded image previews */}
          {imageFiles && Array.from(imageFiles).map((file, i) => (
            <div key={i} className="relative w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 border border-[var(--yrdly-glass-border)]">
              <BlobImage file={file} alt="Preview" className="object-cover w-full h-full" />
              {i === 0 && (
                <div
                  className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-black"
                  style={{ backgroundColor: GREEN }}
                >
                  Cover
                </div>
              )}
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
                <X size={12} />
              </button>
            </div>
          ))}

          {/* Existing images for edit mode */}
          {postToEdit?.image_urls && postToEdit.image_urls.map((url, i) => {
            if (removedImageIndexes.includes(i)) return null;
            return (
              <div key={`existing-${i}`} className="relative w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 border border-[var(--yrdly-glass-border)]">
                <Image src={url} alt={`Existing ${i}`} fill className="object-cover" unoptimized />
                <button
                  type="button"
                  onClick={() => setRemovedImageIndexes((prev) => [...prev, i])}
                  className="absolute top-1 right-1 bg-black/70 rounded-full p-1 text-white hover:bg-black"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
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

      {/* ── Title card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Gem size={15} style={{ color: GREEN }} />
          <label className="text-sm font-bold text-foreground">Title</label>
          <span className="text-red-500 font-bold">*</span>
        </div>
        <input
          {...form.register("title")}
          placeholder="e.g. iPhone 15 Pro 256GB"
          maxLength={80}
          className="w-full bg-transparent outline-none border-none text-foreground placeholder:text-[var(--yrdly-label)] text-base font-medium py-1"
        />
        <p className="text-[11px] text-[var(--yrdly-label)] text-right mt-1 font-mono">
          {title.length}/80
        </p>
      </div>

      {/* ── Price & Category side by side ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        {/* Price Card */}
        <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <PlusCircle size={15} style={{ color: GREEN }} />
            <label className="text-sm font-bold text-foreground">Price</label>
            <span className="text-red-500 font-bold">*</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xl font-bold text-[var(--yrdly-label)]">₦</span>
            <input
              {...form.register("price")}
              placeholder="250,000"
              className="w-full bg-transparent outline-none border-none text-foreground placeholder:text-[var(--yrdly-label)] text-xl font-bold py-1"
              onChange={(e) => {
                const clean = e.target.value.replace(/[^0-9.]/g, "");
                form.setValue("price", clean);
              }}
            />
          </div>
        </div>

        {/* Category Card */}
        <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 relative">
          <div className="flex items-center gap-1.5 mb-2">
            <Grid size={15} style={{ color: GREEN }} />
            <label className="text-sm font-bold text-foreground">Category</label>
            <span className="text-red-500 font-bold">*</span>
          </div>
          <button
            type="button"
            onClick={() => setShowCategoryDropdown((v) => !v)}
            className="w-full flex items-center justify-between text-left py-1 text-base text-foreground font-medium"
          >
            <span className="truncate">{subCategory}</span>
            <ChevronDown size={16} className="text-[var(--yrdly-label)]" />
          </button>
          {showCategoryDropdown && (
            <div className="absolute top-16 left-0 right-0 rounded-xl border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)] shadow-xl z-50 max-h-48 overflow-y-auto py-1">
              {MARKETPLACE_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    form.setValue("subCategory", cat);
                    setShowCategoryDropdown(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-white/5 transition-colors",
                    subCategory === cat ? "text-[#82DB7E] font-bold" : "text-foreground"
                  )}
                >
                  <span>{cat}</span>
                  {subCategory === cat && <Check size={14} style={{ color: GREEN }} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Description card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <FileText size={15} style={{ color: GREEN }} />
          <label className="text-sm font-bold text-foreground">Description</label>
          <span className="text-red-500 font-bold">*</span>
        </div>
        <textarea
          {...form.register("description")}
          placeholder="Describe your item, its condition, features and anything buyers should know..."
          rows={4}
          maxLength={1000}
          className="w-full bg-transparent resize-none outline-none border-none text-foreground placeholder:text-[var(--yrdly-label)] text-sm leading-relaxed"
        />
        <p className="text-[11px] text-[var(--yrdly-label)] text-right mt-1 font-mono">
          {description.length}/1000
        </p>
      </div>

      {/* ── Location card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-3.5 mb-3 flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "rgba(130,219,126,0.12)" }}
        >
          <MapPin size={18} style={{ color: GREEN }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-foreground">
            Location <span className="text-red-500">*</span>
          </p>
          <p className="text-xs text-[var(--yrdly-label)] truncate">{locationLabel}</p>
        </div>
        <ChevronRight size={16} className="text-[var(--yrdly-label)]" />
      </div>

      {/* ── Condition card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3 relative">
        <div className="flex items-center gap-1.5 mb-2">
          <ShieldCheck size={15} style={{ color: GREEN }} />
          <label className="text-sm font-bold text-foreground">Condition</label>
        </div>
        <button
          type="button"
          onClick={() => setShowConditionDropdown((v) => !v)}
          className="w-full flex items-center justify-between text-left py-1 text-base text-foreground font-medium"
        >
          <span>{condition}</span>
          <ChevronDown size={16} className="text-[var(--yrdly-label)]" />
        </button>
        {showConditionDropdown && (
          <div className="absolute top-16 left-0 right-0 rounded-xl border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)] shadow-xl z-50 py-1">
            {ITEM_CONDITIONS.map((cond) => (
              <button
                key={cond}
                type="button"
                onClick={() => {
                  form.setValue("condition", cond);
                  setShowConditionDropdown(false);
                }}
                className={cn(
                  "w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-white/5 transition-colors",
                  condition === cond ? "text-[#82DB7E] font-bold" : "text-foreground"
                )}
              >
                <span>{cond}</span>
                {condition === cond && <Check size={14} style={{ color: GREEN }} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Price type card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-4">
        <div className="flex items-center gap-1.5 mb-1">
          <Tag size={15} style={{ color: GREEN }} />
          <label className="text-sm font-bold text-foreground">Set Price Type</label>
        </div>
        <p className="text-xs text-[var(--yrdly-label)] mb-3">
          Choose how you want to sell this item
        </p>

        {/* Animated segmented toggle */}
        <div className="relative flex rounded-full border border-[var(--yrdly-glass-border)] bg-surface p-1 h-11 overflow-hidden">
          <button
            type="button"
            onClick={() => form.setValue("negotiable", false)}
            className={cn(
              "flex-1 rounded-full text-xs font-bold transition-all z-10",
              !negotiable ? "bg-[#82DB7E] text-black" : "text-[var(--yrdly-label)]"
            )}
          >
            Fixed Price
          </button>
          <button
            type="button"
            onClick={() => form.setValue("negotiable", true)}
            className={cn(
              "flex-1 rounded-full text-xs font-bold transition-all z-10",
              negotiable ? "bg-[#82DB7E] text-black" : "text-[var(--yrdly-label)]"
            )}
          >
            Negotiable
          </button>
        </div>
      </div>

      {/* ── Submit button ── */}
      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full py-4 rounded-full font-black text-base flex items-center justify-center gap-2.5 transition-all disabled:opacity-50"
        style={{
          backgroundColor: canSubmit ? GREEN : "rgba(130,219,126,0.4)",
          color: "#0B0D0B",
          boxShadow: canSubmit ? "0 6px 14px rgba(130,219,126,0.25)" : "none",
        }}
      >
        <Tag size={18} />
        <span>{loading ? "Listing…" : "List Item for Sale"}</span>
      </button>
    </form>
  );
}

const CreateItemDialogComponent = ({
  children,
  postToEdit,
  onOpenChange,
  open: externalOpen,
}: CreateItemDialogProps) => {
  const { createPost } = usePosts();
  const { profile } = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removedImageIndexes, setRemovedImageIndexes] = useState<number[]>([]);
  const isMobile = useIsMobile();
  const isEditMode = !!postToEdit;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const open = externalOpen !== undefined ? externalOpen : internalOpen;

  const remainingExistingImages = (postToEdit?.image_urls?.length || 0) - removedImageIndexes.length;
  const formSchema = useMemo(
    () => getFormSchema(isEditMode, Math.max(remainingExistingImages, 0)),
    [isEditMode, remainingExistingImages]
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      price: "",
      subCategory: "Electronics",
      condition: "New",
      negotiable: false,
      imageFiles: undefined,
    },
  });

  const stableFormReset = useCallback(
    (values: any) => form.reset(values),
    [form]
  );

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (isEditMode && postToEdit) {
          stableFormReset({
            title: postToEdit.title || postToEdit.text,
            description: postToEdit.description || "",
            price: postToEdit.price ? String(postToEdit.price) : "",
            subCategory: postToEdit.category || "Electronics",
            condition: "Good",
            negotiable: false,
            imageFiles: undefined,
          });
        } else if (!isEditMode) {
          stableFormReset({
            title: "",
            description: "",
            price: "",
            subCategory: "Electronics",
            condition: "New",
            negotiable: false,
            imageFiles: undefined,
          });
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open, isEditMode, postToEdit, stableFormReset]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    let filteredImageUrls: string[] = [];
    if (postToEdit?.image_urls) {
      filteredImageUrls = postToEdit.image_urls.filter(
        (_, i) => !removedImageIndexes.includes(i)
      );
    }
    const postData: Partial<Post> = {
      text: `${values.title} - ₦${values.price}`,
      title: values.title,
      description: values.description,
      category: "For Sale",
      price: parseFloat(values.price) || 0,
      image_urls: filteredImageUrls,
    };
    await createPost(postData, postToEdit?.id, values.imageFiles);
    setLoading(false);
    handleOpenChange(false);
  }

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (externalOpen !== undefined) {
        onOpenChange?.(newOpen);
      } else {
        setInternalOpen(newOpen);
        onOpenChange?.(newOpen);
      }
      if (!newOpen) form.reset();
    },
    [onOpenChange, externalOpen, form]
  );

  const formBodyProps: FormBodyProps = {
    form,
    onSubmit,
    loading,
    isEditMode,
    postToEdit,
    removedImageIndexes,
    setRemovedImageIndexes,
    onClose: () => handleOpenChange(false),
    profile,
    fileInputRef,
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
          <FormBody {...formBodyProps} />
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
        className="p-0 border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)] rounded-3xl max-w-[620px] w-full overflow-hidden shadow-2xl"
        hideClose
      >
        <FormBody {...formBodyProps} />
      </DialogContent>
    </Dialog>
  );
};

export const CreateItemDialog = memo(CreateItemDialogComponent);