
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { PlusCircle, X, Upload, MapPin, ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useState, useEffect, memo, useCallback, useMemo } from "react";
import * as React from "react";
import { usePosts } from "@/hooks/use-posts";
import { useIsMobile } from "@/hooks/use-mobile";
import { LocationInput, LocationValue } from "./LocationInput";
import type { Business } from "@/types";
import Image from "next/image";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

const GREEN = "#388E3C";
const CARD = "var(--c-bg)";
const INPUT_BG = "var(--c-card2)";
const FONT = "Inter, sans-serif";
const JAKARTA = "Inter, sans-serif";
const JERSEY = "Jersey 25, cursive";

const BUSINESS_CATEGORIES = [
  "Restaurant & Food",
  "Retail & Shopping",
  "Health & Wellness",
  "Beauty & Personal Care",
  "Automotive",
  "Home & Garden",
  "Professional Services",
  "Entertainment & Recreation",
  "Education & Training",
  "Technology & Electronics",
  "Real Estate",
  "Financial Services",
  "Travel & Tourism",
  "Sports & Fitness",
  "Arts & Crafts",
  "Pet Services",
  "Cleaning Services",
  "Repair & Maintenance",
  "Other",
];

const getFormSchema = (isEditMode: boolean, postToEdit?: Business) =>
  z.object({
    name: z.string().min(1, "Business name can't be empty."),
    category: z.string().min(1, "Please select a category."),
    description: z.string().optional(),
    location: z.custom<LocationValue>().refine((v) => v && v.address.length > 0, {
      message: "Location is required.",
    }),
    image: z
      .any()
      .refine(
        (files) =>
          files &&
          (files.length > 0 ||
            (Array.isArray(files) && files.some((f) => typeof f === "string"))),
        "An image is required."
      ),
    hours: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    website: z.string().url().optional().or(z.literal("")),
    owner_name: z.string().optional(),
    owner_avatar: z.string().optional(),
  });

type CreateBusinessDialogProps = {
  children?: React.ReactNode;
  postToEdit?: Business;
  onOpenChange?: (open: boolean) => void;
};

// ── Shared styled input ──────────────────────────────────────────
function StyledInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className="space-y-2">
      <label className="block text-[0.8125rem] font-medium ml-4" style={{ fontFamily: FONT, color: "var(--c-text-muted)" }}>
        {label}
      </label>
      <input
        {...props}
        className="w-full h-12 rounded-full px-6 text-foreground text-sm outline-none focus:ring-1 transition-all"
        style={{
          background: INPUT_BG,
          border: `0.5px solid rgba(130,219,126,0.4)`,
          fontFamily: FONT,
          caretColor: GREEN,
          ...(props.style ?? {}),
        }}
      />
    </div>
  );
}

function StyledTextarea({ label, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <div className="space-y-2">
      <label className="block text-[0.8125rem] font-medium ml-4" style={{ fontFamily: FONT, color: "var(--c-text-muted)" }}>
        {label}
      </label>
      <textarea
        {...props}
        className="w-full rounded-[11px] px-6 py-4 text-foreground text-sm outline-none focus:ring-1 transition-all resize-none"
        style={{
          background: INPUT_BG,
          border: `0.5px solid rgba(130,219,126,0.4)`,
          fontFamily: FONT,
          caretColor: GREEN,
        }}
      />
    </div>
  );
}

// ── Main form body ──────────────────────────────────────────────
function BusinessFormBody({
  form,
  postToEdit,
  removedImageIndexes,
  setRemovedImageIndexes,
  loading,
  onClose,
  isEditMode,
}: {
  form: ReturnType<typeof useForm<any>>;
  postToEdit?: Business;
  removedImageIndexes: number[];
  setRemovedImageIndexes: React.Dispatch<React.SetStateAction<number[]>>;
  loading: boolean;
  onClose: () => void;
  isEditMode: boolean;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [previewFiles, setPreviewFiles] = React.useState<string[]>([]);

  const handleFileChange = (files: FileList | null) => {
    if (!files) return;
    form.setValue("image", files);
    const previews: string[] = [];
    Array.from(files).forEach((f) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        previews.push(e.target?.result as string);
        if (previews.length === files.length) setPreviewFiles([...previews]);
      };
      reader.readAsDataURL(f);
    });
  };

  return (
    <>
      {/* ── Header ── */}
      <header
        className="flex items-center justify-between px-6 py-5 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(64,73,61,0.1)" }}
      >
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full transition-colors"
            style={{ color: "var(--c-text-muted)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
          >
            <X className="w-5 h-5" />
          </button>
          <h1 className="text-[1.125rem] font-bold text-foreground" style={{ fontFamily: FONT }}>
            {isEditMode ? "Edit Business" : "Add a Business"}
          </h1>
        </div>
        <span className="text-2xl tracking-tight" style={{ fontFamily: JERSEY, color: GREEN }}>
          Yrdly
        </span>
      </header>

      {/* ── Scrollable form ── */}
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8" style={{ scrollbarWidth: "none" }}>
        {/* Identity */}
        <div className="space-y-6">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <StyledInput label="Business Name" placeholder="e.g. Lekki Heights Bistro" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <div className="space-y-2">
                    <label className="block text-[0.8125rem] font-medium ml-4" style={{ fontFamily: FONT, color: "var(--c-text-muted)" }}>
                      Category
                    </label>
                    <div className="relative">
                      <select
                        value={field.value}
                        onChange={field.onChange}
                        className="w-full h-12 rounded-full px-6 appearance-none text-foreground text-sm outline-none focus:ring-1 transition-all"
                        style={{ background: INPUT_BG, border: `0.5px solid rgba(130,219,126,0.4)`, fontFamily: FONT }}
                      >
                        <option value="">Select a category</option>
                        {BUSINESS_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: GREEN }} />
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="hours"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <StyledInput label="Business Hours" placeholder="Mon - Sat, 9am - 6pm" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <StyledTextarea
                    label="Description"
                    placeholder="Tell us about your business, specialties, and unique vibe..."
                    rows={4}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Images */}
        <FormField
          control={form.control}
          name="image"
          render={({ field: { onChange } }) => (
            <FormItem>
              <div className="space-y-2">
                <label className="block text-[0.8125rem] font-medium ml-4" style={{ fontFamily: FONT, color: "var(--c-text-muted)" }}>
                  Business Photos
                </label>
                <div
                  className="w-full flex flex-col items-center justify-center p-8 cursor-pointer transition-all"
                  style={{
                    border: `2px dashed ${dragOver ? GREEN : "rgba(64,73,61,0.3)"}`,
                    borderRadius: 16,
                    background: dragOver ? "rgba(56,142,60,0.05)" : "rgba(11,14,19,0.3)",
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFileChange(e.dataTransfer.files); onChange(e.dataTransfer.files); }}
                >
                  <Upload className="w-10 h-10 mb-3 transition-transform" style={{ color: GREEN, transform: dragOver ? "scale(1.1)" : "scale(1)" }} />
                  <p className="text-foreground font-medium text-sm" style={{ fontFamily: FONT }}>Upload business photos</p>
                  <p className="text-sm mt-1" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>Drag and drop or click to browse (Max 5MB)</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { handleFileChange(e.target.files); onChange(e.target.files); }}
                />
                {/* New image previews */}
                {previewFiles.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-2">
                    {previewFiles.map((src, i) => (
                      <div key={i} className="relative rounded-[10px] overflow-hidden h-20">
                        <Image src={src} alt={`Preview ${i + 1}`} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover" />
                      </div>
                    ))}
                  </div>
                )}
                {/* Existing images (edit mode) */}
                {postToEdit?.image_urls && postToEdit.image_urls.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
                    {postToEdit.image_urls.map((url, idx) => {
                      const removed = removedImageIndexes.includes(idx);
                      return (
                        <div key={idx} className={`relative rounded-[10px] overflow-hidden h-20 group ${removed ? "opacity-50" : ""}`}>
                          <Image src={url} alt={`Image ${idx + 1}`} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw" className="object-cover" />
                          {!removed && (
                            <button
                              type="button"
                              onClick={() => setRemovedImageIndexes((p) => [...p, idx])}
                              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full text-foreground text-xs flex items-center justify-center opacity-0 group-hover:opacity-100"
                              style={{ background: "#E53935" }}
                            >×</button>
                          )}
                          {removed && (
                            <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(229,57,53,0.2)" }}>
                              <X className="w-5 h-5 text-red-400" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Location */}
        <FormField
          control={form.control}
          name="location"
          render={({ field }) => (
            <FormItem>
              <div className="space-y-2">
                <label className="block text-[0.8125rem] font-medium ml-4" style={{ fontFamily: FONT, color: "var(--c-text-muted)" }}>
                  Location
                </label>
                <FormControl>
                  <LocationInput
                    name={field.name}
                    control={form.control}
                    defaultValue={field.value}
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Contact */}
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <div className="space-y-2">
                    <label className="block text-[0.8125rem] font-medium ml-4" style={{ fontFamily: FONT, color: "var(--c-text-muted)" }}>
                      Phone (+234)
                    </label>
                    <div
                      className="flex items-center h-12 rounded-full px-4"
                      style={{ background: INPUT_BG, border: `0.5px solid rgba(130,219,126,0.4)` }}
                    >
                      <span className="font-medium mr-2 text-sm" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>+234</span>
                      <input
                        type="tel"
                        placeholder="801 234 5678"
                        {...field}
                        className="bg-transparent border-none p-0 w-full text-foreground text-sm outline-none"
                        style={{ fontFamily: FONT }}
                      />
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <StyledInput label="Email" type="email" placeholder="contact@business.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <StyledInput label="Website" type="url" placeholder="https://www.yourbusiness.ng" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* Footer */}
      <footer
        className="px-6 py-5 flex-shrink-0"
        style={{ borderTop: "1px solid rgba(64,73,61,0.1)", background: CARD }}
      >
        <button
          type="submit"
          disabled={loading}
          className="w-full h-14 rounded-full text-foreground font-bold text-lg transition-all active:scale-[0.98] disabled:opacity-60"
          style={{ background: GREEN, fontFamily: FONT, boxShadow: "0 8px 24px rgba(56,142,60,0.2)" }}
        >
          {loading ? (isEditMode ? "Saving..." : "Adding Business...") : (isEditMode ? "Save Changes" : "Add Business")}
        </button>
        <p className="text-center text-[0.6875rem] mt-3" style={{ color: "var(--c-text-muted)", fontFamily: FONT }}>
          By listing your business, you agree to Yrdly&apos;s{" "}
          <span className="underline cursor-pointer" style={{ color: GREEN }}>Terms of Service</span>.
        </p>
      </footer>
    </>
  );
}

// ── Main component ──────────────────────────────────────────────
const CreateBusinessDialogComponent = ({ children, postToEdit, onOpenChange }: CreateBusinessDialogProps) => {
  const { createBusiness } = usePosts();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removedImageIndexes, setRemovedImageIndexes] = useState<number[]>([]);
  const isMobile = useIsMobile();
  const isEditMode = !!postToEdit;

  const formSchema = useMemo(() => getFormSchema(isEditMode, postToEdit), [isEditMode, postToEdit]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "", category: "", description: "",
      location: { address: "" }, image: undefined,
      hours: "", phone: "", email: "", website: "",
      owner_name: "", owner_avatar: "",
    },
  });

  const stableFormReset = useCallback((values: any) => { form.reset(values); }, [form]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => {
        if (isEditMode && postToEdit) {
          stableFormReset({
            name: postToEdit.name, category: postToEdit.category,
            description: postToEdit.description, location: postToEdit.location,
            image: postToEdit.image_urls || [], hours: postToEdit.hours,
            phone: postToEdit.phone, email: postToEdit.email,
            website: postToEdit.website, owner_name: postToEdit.owner_name,
            owner_avatar: postToEdit.owner_avatar,
          });
        } else if (!isEditMode) {
          stableFormReset({
            name: "", category: "", description: "",
            location: { address: "" }, image: undefined,
            hours: "", phone: "", email: "", website: "",
            owner_name: "", owner_avatar: "",
          });
        }
      }, 0);
      return () => clearTimeout(t);
    }
  }, [open, isEditMode, postToEdit, stableFormReset]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    let filteredImageUrls: string[] = [];
    if (postToEdit?.image_urls) {
      filteredImageUrls = postToEdit.image_urls.filter((_, i) => !removedImageIndexes.includes(i));
    }
    let validImageFiles: FileList | undefined;
    if (values.image && values.image.length > 0) {
      const valid = Array.from(values.image).filter((f) => f && f instanceof File && f.name && (f as File).size > 0);
      if (valid.length > 0) {
        const dt = new DataTransfer();
        valid.forEach((f) => dt.items.add(f as File));
        validImageFiles = dt.files;
      }
    }
    const data: Omit<Business, "id" | "owner_id" | "created_at"> = {
      name: values.name, category: values.category,
      description: values.description || "", location: values.location,
      image_urls: filteredImageUrls, hours: values.hours,
      phone: values.phone, email: values.email,
      website: values.website, owner_name: values.owner_name,
      owner_avatar: values.owner_avatar,
    };
    await createBusiness(data, postToEdit?.id, validImageFiles);
    setLoading(false);
    handleOpenChange(false);
  }

  const handleOpenChange = useCallback((val: boolean) => {
    setOpen(val);
    if (onOpenChange) onOpenChange(val);
    if (!val) { form.reset(); setRemovedImageIndexes([]); }
  }, [onOpenChange, form]);

  const sharedProps = { form, postToEdit, removedImageIndexes, setRemovedImageIndexes, loading, isEditMode, onClose: () => handleOpenChange(false) };

  // ── Default trigger (when no children) ──
  const DefaultTrigger = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
    const { profile } = useAuth();
    return (
      <div ref={ref} {...props} className="flex items-center gap-4 w-full cursor-pointer">
        <Avatar>
          <AvatarImage src={profile?.avatar_url || ""} />
          <AvatarFallback>{profile?.name?.charAt(0) || "U"}</AvatarFallback>
        </Avatar>
        <div className="flex-1 text-left text-sm rounded-full px-4 py-2" style={{ background: INPUT_BG, color: "var(--c-text-muted)", fontFamily: "Inter, sans-serif" }}>
          Add a business...
        </div>
        <PlusCircle className="w-6 h-6 flex-shrink-0" style={{ color: GREEN }} />
      </div>
    );
  });
  DefaultTrigger.displayName = "DefaultTrigger";

  const contentStyle: React.CSSProperties = {
    background: 'var(--c-card)',
    display: "flex",
    flexDirection: "column",
    padding: 0,
    border: "none",
  };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>{children || <DefaultTrigger />}</SheetTrigger>
        <SheetContent side="bottom" style={{ ...contentStyle, height: "90vh", maxHeight: "100vh", borderRadius: "28px 28px 0 0" }}>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full">
              <BusinessFormBody {...sharedProps} />
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children || <DefaultTrigger />}</DialogTrigger>
      <DialogContent style={{ ...contentStyle, maxWidth: 640, height: "92vh", maxHeight: "92vh", borderRadius: 20, overflow: "hidden" }} hideClose>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full min-h-0">
            <BusinessFormBody {...sharedProps} />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export const CreateBusinessDialog = memo(CreateBusinessDialogComponent);
