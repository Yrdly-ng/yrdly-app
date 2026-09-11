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
import { X, Calendar, Image as ImageIcon, Tag, FileText, MapPin, Grid, Ticket, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useState, useEffect, memo, useCallback, useMemo, useRef } from "react";
import * as React from "react";
import { LocationInput } from "./LocationInput";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePosts } from "@/hooks/use-posts";
import type { Post } from "@/types";
import Image from "next/image";
import { cn } from "@/lib/utils";

const GREEN = "#82DB7E";

export const EVENT_CATEGORIES = [
  "Party",
  "Music",
  "Sports",
  "Food",
  "Networking",
  "Community",
  "Education",
  "Arts",
  "Tech",
  "Other",
];

export interface TicketTierInput {
  id: string;
  name: string;
  price: string;
  capacity: string;
}

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

const getFormSchema = (isEditMode: boolean) =>
  z.object({
    title: z.string().min(1, "Event title can't be empty.").max(80),
    description: z.string().min(1, "Event description is required.").max(1000),
    eventDate: z.string().min(1, "Date is required."),
    eventTime: z.string().min(1, "Time is required."),
    location: z.any().optional(),
    eventCategory: z.string().default("Community"),
    isTicketed: z.boolean().default(false),
    imageFiles: z.any().optional(),
  });

type CreateEventDialogProps = {
  children?: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
  postToEdit?: Post;
  open?: boolean;
};

// Collapsible ticket card component
function TicketCard({
  tier,
  idx,
  onChange,
  onRemove,
  canRemove,
}: {
  tier: TicketTierInput;
  idx: number;
  onChange: (t: TicketTierInput) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="rounded-xl border border-[var(--yrdly-glass-border)] bg-surface p-3 mb-2.5">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "rgba(130,219,126,0.15)" }}
          >
            <Ticket size={14} style={{ color: GREEN }} />
          </div>
          <span className="text-sm font-bold text-foreground">
            {tier.name || `Ticket ${idx + 1}`}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {!open && (
            <span className="text-xs font-bold" style={{ color: GREEN }}>
              {tier.price === "0" || !tier.price ? "Free" : `₦${tier.price}`}
            </span>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="text-red-500 hover:text-red-400 p-1"
            >
              <Trash2 size={16} />
            </button>
          )}
          {open ? (
            <ChevronUp size={16} className="text-[var(--yrdly-label)]" />
          ) : (
            <ChevronDown size={16} className="text-[var(--yrdly-label)]" />
          )}
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2.5 pt-2 border-t border-[var(--yrdly-glass-border)]">
          <input
            type="text"
            value={tier.name}
            onChange={(e) => onChange({ ...tier, name: e.target.value })}
            placeholder="Ticket name (e.g. VIP)"
            className="w-full bg-card rounded-lg border border-[var(--yrdly-glass-border)] px-3 py-2 text-xs text-foreground placeholder:text-[var(--yrdly-label)] outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-[var(--yrdly-label)] mb-1 block">Price (₦)</label>
              <input
                type="text"
                value={tier.price}
                onChange={(e) => onChange({ ...tier, price: e.target.value.replace(/[^0-9.]/g, "") })}
                placeholder="0 for Free"
                className="w-full bg-card rounded-lg border border-[var(--yrdly-glass-border)] px-3 py-2 text-xs text-foreground placeholder:text-[var(--yrdly-label)] outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-[var(--yrdly-label)] mb-1 block">Capacity</label>
              <input
                type="text"
                value={tier.capacity}
                onChange={(e) => onChange({ ...tier, capacity: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="Unlimited"
                className="w-full bg-card rounded-lg border border-[var(--yrdly-glass-border)] px-3 py-2 text-xs text-foreground placeholder:text-[var(--yrdly-label)] outline-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CreateEventDialogComponent = memo(function CreateEventDialog({
  children,
  onOpenChange,
  postToEdit,
  open: externalOpen,
}: CreateEventDialogProps) {
  const { createPost } = usePosts();
  const { profile } = useAuth();
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removedImageIndexes, setRemovedImageIndexes] = useState<number[]>([]);
  const isMobile = useIsMobile();
  const isEditMode = !!postToEdit;
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [ticketTiers, setTicketTiers] = useState<TicketTierInput[]>([
    { id: "1", name: "General Admission", price: "0", capacity: "" },
  ]);

  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const formSchema = useMemo(() => getFormSchema(isEditMode), [isEditMode]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      eventDate: "",
      eventTime: "",
      location: undefined,
      eventCategory: "Community",
      isTicketed: false,
      imageFiles: undefined,
    },
  });

  const title = form.watch("title") as string || "";
  const description = form.watch("description") as string || "";
  const eventCategory = form.watch("eventCategory") as string || "Community";
  const isTicketed = form.watch("isTicketed") as boolean || false;
  const imageFiles = form.watch("imageFiles") as FileList | undefined;

  const locFromProfile = [profile?.location?.ward, profile?.location?.lga, profile?.location?.state]
    .filter(Boolean)
    .join(", ");

  const totalImageCount = (imageFiles ? imageFiles.length : 0) + ((postToEdit?.image_urls?.length || 0) - removedImageIndexes.length);
  const canPublish = title.trim().length > 0 && !loading;

  const handleOpenChange = useCallback(
    (newOpenState: boolean) => {
      if (externalOpen !== undefined) {
        onOpenChange?.(newOpenState);
      } else {
        setInternalOpen(newOpenState);
        onOpenChange?.(newOpenState);
      }
      if (!newOpenState) {
        form.reset();
        setRemovedImageIndexes([]);
      }
    },
    [onOpenChange, externalOpen, form]
  );

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (isEditMode && postToEdit) {
          form.reset({
            title: postToEdit.title || postToEdit.text,
            description: postToEdit.description || postToEdit.text || "",
            eventDate: postToEdit.event_date || "",
            eventTime: postToEdit.event_time || "",
            location: postToEdit.event_location,
            eventCategory: postToEdit.category || "Community",
            isTicketed: false,
            imageFiles: undefined,
          });
        } else if (!isEditMode) {
          form.reset({
            title: "",
            description: "",
            eventDate: new Date().toISOString().slice(0, 10),
            eventTime: "18:00",
            location: undefined,
            eventCategory: "Community",
            isTicketed: false,
            imageFiles: undefined,
          });
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open, isEditMode, postToEdit, form]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    let filteredImageUrls: string[] = [];
    if (postToEdit?.image_urls) {
      filteredImageUrls = postToEdit.image_urls.filter((_, index) => !removedImageIndexes.includes(index));
    }

    const eventData: Partial<Post> = {
      category: "Event",
      text: values.description,
      title: values.title,
      event_location: values.location,
      event_date: values.eventDate,
      event_time: values.eventTime,
      image_urls: filteredImageUrls,
    };
    await createPost(eventData, postToEdit?.id, values.imageFiles);
    setLoading(false);
    handleOpenChange(false);
  }

  const addTier = () => {
    setTicketTiers((tiers) => [
      ...tiers,
      { id: Date.now().toString(), name: "", price: "0", capacity: "" },
    ]);
  };

  const updateTier = (i: number, t: TicketTierInput) => {
    setTicketTiers((tiers) => {
      const copy = [...tiers];
      copy[i] = t;
      return copy;
    });
  };

  const removeTier = (i: number) => {
    setTicketTiers((tiers) => tiers.filter((_, idx) => idx !== i));
  };

  const formContent = (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col p-4 sm:p-6 text-foreground font-yrdly-body max-h-[85vh] overflow-y-auto"
    >
      {/* ── Top close button ── */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold font-yrdly-display">
          {isEditMode ? "Edit Event" : "Create Event"}
        </h2>
        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          className="w-8 h-8 rounded-full bg-surface border border-[var(--yrdly-glass-border)] flex items-center justify-center text-foreground hover:opacity-70 transition-opacity"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Host card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-3.5 mb-3 flex items-center gap-3">
        {profile?.avatar_url ? (
          <Image
            src={profile.avatar_url}
            alt={profile?.name || "Host"}
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
            <div
              className="flex items-center gap-1 rounded-full px-2.5 py-1 border text-xs font-extrabold"
              style={{
                backgroundColor: "rgba(130,219,126,0.12)",
                borderColor: "rgba(130,219,126,0.4)",
                color: GREEN,
              }}
            >
              <Calendar size={10} />
              <span>Event</span>
            </div>
          </div>
          <p className="text-xs text-[var(--yrdly-label)] truncate mt-0.5">
            {locFromProfile || "No location set"} · <span className="text-[#82DB7E]">Public</span>
          </p>
        </div>
      </div>

      {/* ── Event Cover card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <ImageIcon size={15} style={{ color: GREEN }} />
            <span className="text-sm font-bold text-foreground">
              Event Cover <span className="text-red-500">*</span>
            </span>
          </div>
          <span className="text-xs text-[var(--yrdly-label)] font-mono">
            {totalImageCount}/10
          </span>
        </div>
        <p className="text-xs text-[var(--yrdly-label)] mb-3">Add a cover photo for your event</p>

        {totalImageCount === 0 ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-8 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors"
            style={{ borderColor: GREEN, backgroundColor: "rgba(130,219,126,0.05)" }}
          >
            <ImageIcon size={32} style={{ color: GREEN }} />
            <span className="text-sm font-bold text-foreground">Add Cover Photo</span>
            <span className="text-xs text-[var(--yrdly-label)]">JPG, PNG or WebP. Max 10MB</span>
          </button>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-2">
            {imageFiles && Array.from(imageFiles).map((file, i) => (
              <div key={i} className="relative w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 border border-[var(--yrdly-glass-border)]">
                <BlobImage file={file} alt="Cover Preview" className="object-cover w-full h-full" />
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

      {/* ── Event Title card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <Tag size={15} style={{ color: GREEN }} />
          <label className="text-sm font-bold text-foreground">
            Event Title <span className="text-red-500">*</span>
          </label>
        </div>
        <input
          {...form.register("title")}
          placeholder="e.g. Community Football Tournament"
          maxLength={80}
          className="w-full bg-transparent outline-none border-none text-foreground placeholder:text-[var(--yrdly-label)] text-base font-medium py-1"
        />
        <p className="text-[11px] text-[var(--yrdly-label)] text-right mt-1 font-mono">
          {title.length}/80
        </p>
      </div>

      {/* ── Event Description card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <FileText size={15} style={{ color: GREEN }} />
          <label className="text-sm font-bold text-foreground">
            Event Description <span className="text-red-500">*</span>
          </label>
        </div>
        <textarea
          {...form.register("description")}
          placeholder="Tell people about your event..."
          rows={4}
          maxLength={1000}
          className="w-full bg-transparent resize-none outline-none border-none text-foreground placeholder:text-[var(--yrdly-label)] text-sm leading-relaxed"
        />
        <p className="text-[11px] text-[var(--yrdly-label)] text-right mt-1 font-mono">
          {description.length}/1000
        </p>
      </div>

      {/* ── Date & Time row ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Calendar size={14} style={{ color: GREEN }} />
            <label className="text-sm font-bold text-foreground">
              Date <span className="text-red-500">*</span>
            </label>
          </div>
          <input
            type="date"
            {...form.register("eventDate")}
            className="w-full bg-transparent outline-none border-none text-foreground text-sm py-1 font-medium"
          />
        </div>
        <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Calendar size={14} style={{ color: GREEN }} />
            <label className="text-sm font-bold text-foreground">
              Time <span className="text-red-500">*</span>
            </label>
          </div>
          <input
            type="time"
            {...form.register("eventTime")}
            className="w-full bg-transparent outline-none border-none text-foreground text-sm py-1 font-medium"
          />
        </div>
      </div>

      {/* ── Location card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <div className="flex items-center gap-1.5 mb-2">
          <MapPin size={15} style={{ color: GREEN }} />
          <label className="text-sm font-bold text-foreground">
            Location <span className="text-red-500">*</span>
          </label>
        </div>
        <LocationInput name="location" control={form.control} />
      </div>

      {/* ── Category chips card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3">
        <div className="flex items-center gap-1.5 mb-3">
          <Grid size={15} style={{ color: GREEN }} />
          <label className="text-sm font-bold text-foreground">
            Category <span className="text-red-500">*</span>
          </label>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {EVENT_CATEGORIES.map((cat) => {
            const active = eventCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => form.setValue("eventCategory", cat)}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-bold transition-all border flex-shrink-0",
                  active
                    ? "bg-[#82DB7E] border-[#82DB7E] text-black"
                    : "bg-surface border-[var(--yrdly-glass-border)] text-[var(--yrdly-label)] hover:text-foreground"
                )}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Ticketed switch card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-foreground">Is this a ticketed event?</p>
          <p className="text-xs text-[var(--yrdly-label)]">Charge for entry and manage tickets</p>
        </div>
        <input
          type="checkbox"
          checked={isTicketed}
          onChange={(e) => form.setValue("isTicketed", e.target.checked)}
          className="w-5 h-5 accent-[#82DB7E] cursor-pointer"
        />
      </div>

      {/* ── Ticket settings card ── */}
      <div className="rounded-2xl border border-[var(--yrdly-glass-border)] bg-card p-4 mb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5">
            <Ticket size={15} style={{ color: GREEN }} />
            <span className="text-sm font-bold text-foreground">Ticket Settings</span>
          </div>
          {isTicketed && (
            <button
              type="button"
              onClick={addTier}
              className="flex items-center gap-1 text-xs font-bold"
              style={{ color: GREEN }}
            >
              <Plus size={14} />
              <span>Add Tickets</span>
            </button>
          )}
        </div>
        <p className="text-xs text-[var(--yrdly-label)] mb-3">Add tickets, pricing and availability</p>

        {ticketTiers.map((tier, i) => (
          <TicketCard
            key={tier.id}
            tier={tier}
            idx={i}
            onChange={(t) => updateTier(i, t)}
            onRemove={() => removeTier(i)}
            canRemove={ticketTiers.length > 1}
          />
        ))}
      </div>

      {/* ── Submit button ── */}
      <button
        type="submit"
        disabled={!canPublish}
        className="w-full py-4 rounded-full font-black text-base flex items-center justify-center gap-2.5 transition-all disabled:opacity-50"
        style={{
          backgroundColor: canPublish ? GREEN : "rgba(130,219,126,0.4)",
          color: "#0B0D0B",
          boxShadow: canPublish ? "0 6px 14px rgba(130,219,126,0.25)" : "none",
        }}
      >
        <Calendar size={18} />
        <span>{loading ? "Creating Event…" : "Create Event"}</span>
      </button>
    </form>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>{children ?? <span />}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="p-0 border-0 rounded-t-3xl bg-[var(--yrdly-dark)] max-h-[92dvh] overflow-y-auto"
          hideClose
        >
          {formContent}
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
        {formContent}
      </DialogContent>
    </Dialog>
  );
});

CreateEventDialogComponent.displayName = "CreateEventDialogComponent";

export const CreateEventDialog = CreateEventDialogComponent;
