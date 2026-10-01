"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Briefcase,
  X,
  ShoppingBag,
  Wrench,
  Layers,
  MapPin,
  Clock,
  Phone,
  Mail,
  Globe,
  UploadCloud,
  Check,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Building2,
  Tag,
  Image as ImageIcon,
} from "lucide-react";
import { useState, useEffect, memo, useCallback, useMemo } from "react";
import * as React from "react";
import { LocationInput, LocationValue } from "./LocationInput";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePosts } from "@/hooks/use-posts";
import type { Business, BusinessMode } from "@/types";
import Image from "next/image";
import { cn } from "@/lib/utils";

const inputBase =
  "bg-background/80 border border-border/80 text-foreground placeholder:text-muted-foreground/70 placeholder:italic font-sans text-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:border-primary transition-all";
const labelClass = "font-sans font-semibold text-xs text-foreground/90 flex items-center gap-1.5";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const CATEGORIES = [
  'Food & Drinks',
  'Retail',
  'Services',
  'Tech',
  'Health',
  'Fashion',
  'Beauty',
  'Entertainment',
  'Other',
];

const BUSINESS_MODES: {
  value: BusinessMode;
  label: string;
  badge: string;
  description: string;
  icon: React.ElementType;
}[] = [
  {
    value: 'product',
    label: 'Products',
    badge: 'Retail & Sales',
    description: 'Physical items & retail catalog',
    icon: ShoppingBag,
  },
  {
    value: 'service',
    label: 'Services',
    badge: 'Bookings & Work',
    description: 'Appointments & service offerings',
    icon: Wrench,
  },
  {
    value: 'both',
    label: 'Hybrid / Both',
    badge: 'Full Suite',
    description: 'Sell products & take service bookings',
    icon: Layers,
  },
];

function formatTime12h(time24: string): string {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mStr} ${period}`;
}

function formatHours(selectedDays: string[], openTime: string, closeTime: string): string {
  if (selectedDays.length === 0 || !openTime || !closeTime) return "";

  const orderedSelected = WEEK_DAYS.filter((d) => selectedDays.includes(d));
  const groups: string[][] = [];
  let current: string[] = [];

  orderedSelected.forEach((day, i) => {
    const dayIndex = WEEK_DAYS.indexOf(day);
    const prevDay = orderedSelected[i - 1];
    const isConsecutive = prevDay && WEEK_DAYS.indexOf(prevDay) === dayIndex - 1;
    if (isConsecutive) {
      current.push(day);
    } else {
      if (current.length) groups.push(current);
      current = [day];
    }
  });
  if (current.length) groups.push(current);

  const dayLabel = groups
    .map((g) => (g.length > 1 ? `${g[0]}-${g[g.length - 1]}` : g[0]))
    .join(", ");

  return `${dayLabel} ${formatTime12h(openTime)}-${formatTime12h(closeTime)}`;
}

function parseHours(hours?: string): { days: string[]; open: string; close: string } {
  if (!hours) return { days: [], open: "", close: "" };
  const match = hours.match(/^(.*?)\s+(\d{1,2}:\d{2}\s?[AP]M)-(\d{1,2}:\d{2}\s?[AP]M)$/i);
  if (!match) return { days: [], open: "", close: "" };

  const to24h = (t: string) => {
    const m = t.match(/(\d{1,2}):(\d{2})\s?([AP]M)/i);
    if (!m) return "";
    let h = parseInt(m[1], 10);
    const min = m[2];
    const period = m[3].toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${min}`;
  };

  const dayPart = match[1];
  const days: string[] = [];
  dayPart.split(",").forEach((segment) => {
    const trimmed = segment.trim();
    if (trimmed.includes("-")) {
      const [start, end] = trimmed.split("-").map((d) => d.trim());
      const startIdx = WEEK_DAYS.indexOf(start as any);
      const endIdx = WEEK_DAYS.indexOf(end as any);
      if (startIdx !== -1 && endIdx !== -1) {
        for (let i = startIdx; i <= endIdx; i++) days.push(WEEK_DAYS[i]);
      }
    } else if (WEEK_DAYS.includes(trimmed as any)) {
      days.push(trimmed);
    }
  });

  return { days, open: to24h(match[2]), close: to24h(match[3]) };
}

const BlobImage = memo(({ file, className }: { file: File; className?: string }) => {
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={className} />;
});
BlobImage.displayName = "BlobImage";

const getFormSchema = (isEditMode: boolean, businessToEdit?: Business) =>
  z.object({
    name: z.string().min(1, "Business name can't be empty.").max(100),
    mode: z.enum(["product", "service", "both"]),
    category: z.string().min(1, "Category is required.").max(50),
    description: z.string().min(1, "Description is required.").max(1000),
    location: z.custom<LocationValue>().refine((value) => value && value.address.length > 0, {
      message: "Location is required.",
    }),
    phone: z
      .string()
      .refine((val) => val === "" || /^\+234\d{7,10}$/.test(val), {
        message: "Phone number must start with +234, e.g. +2348012345678.",
      })
      .optional()
      .or(z.literal("")),
    email: z
      .string()
      .refine((val) => val === "" || val.toLowerCase().endsWith("@gmail.com"), {
        message: "Email must end with @gmail.com.",
      })
      .optional()
      .or(z.literal("")),
    website: z.union([z.string().url("Please enter a valid URL."), z.literal("")]).optional(),
    hours: z.string().max(100).optional().or(z.literal("")),
    image: z.any().refine((files) => {
      if (isEditMode && businessToEdit?.image_urls?.length) return true;
      return (
        files &&
        ((typeof FileList !== "undefined" && files instanceof FileList && files.length > 0) ||
          (Array.isArray(files) && files.some((f) => typeof f === "string")))
      );
    }, "At least one photo is required."),
  });

type CreateBusinessDialogProps = {
  children?: React.ReactNode;
  businessToEdit?: Business;
  onOpenChange?: (open: boolean) => void;
  onCreated?: (businessId?: string) => void;
  open?: boolean;
};

const CreateBusinessDialogComponent = memo(function CreateBusinessDialog({
  children,
  businessToEdit,
  onOpenChange,
  onCreated,
  open: externalOpen,
}: CreateBusinessDialogProps) {
  const { createBusiness } = usePosts();
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState<1 | 2>(1);
  const [removedImageIndexes, setRemovedImageIndexes] = useState<number[]>([]);
  const [hoursDays, setHoursDays] = useState<string[]>([]);
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");
  const isMobile = useIsMobile();
  const isEditMode = !!businessToEdit;

  const open = externalOpen !== undefined ? externalOpen : internalOpen;

  const formSchema = useMemo(
    () => getFormSchema(isEditMode, businessToEdit),
    [isEditMode, businessToEdit]
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      mode: "both",
      category: "",
      description: "",
      location: { address: "" },
      phone: "",
      email: "",
      website: "",
      hours: "",
      image: undefined,
    },
  });

  const stableFormReset = useCallback((values: any) => form.reset(values), [form]);

  // Keep hidden `hours` field in sync with hours state
  useEffect(() => {
    form.setValue("hours", formatHours(hoursDays, openTime, closeTime), { shouldValidate: false });
  }, [hoursDays, openTime, closeTime, form]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (isEditMode && businessToEdit) {
          stableFormReset({
            name: businessToEdit.name,
            mode: (businessToEdit.mode as BusinessMode) || "both",
            category: businessToEdit.category,
            description: businessToEdit.description,
            location: businessToEdit.location,
            phone: businessToEdit.phone || "",
            email: businessToEdit.email || "",
            website: businessToEdit.website || "",
            hours: businessToEdit.hours || "",
            image: businessToEdit.image_urls || [],
          });
          const parsed = parseHours(businessToEdit.hours);
          setHoursDays(parsed.days);
          setOpenTime(parsed.open);
          setCloseTime(parsed.close);
        } else if (!isEditMode) {
          stableFormReset({
            name: "",
            mode: "both",
            category: "",
            description: "",
            location: { address: "" },
            phone: "",
            email: "",
            website: "",
            hours: "",
            image: undefined,
          });
          setHoursDays([]);
          setOpenTime("");
          setCloseTime("");
        }
        setActiveStep(1);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open, isEditMode, businessToEdit, stableFormReset]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);

    let filteredImageUrls: string[] = [];
    if (businessToEdit?.image_urls) {
      filteredImageUrls = businessToEdit.image_urls.filter((_, i) => !removedImageIndexes.includes(i));
    }

    let validImageFiles: FileList | undefined;
    if (values.image && values.image.length > 0) {
      const validFiles = Array.from(values.image).filter(
        (f) => f && f instanceof File && (f as File).size > 0
      );
      if (validFiles.length > 0) {
        const dt = new DataTransfer();
        validFiles.forEach((f) => dt.items.add(f as File));
        validImageFiles = dt.files;
      }
    }

    const businessData: Omit<Business, "id" | "owner_id" | "created_at"> = {
      name: values.name,
      mode: values.mode,
      category: values.category,
      description: values.description,
      location: values.location,
      phone: values.phone || undefined,
      email: values.email || undefined,
      website: values.website || undefined,
      hours: values.hours || undefined,
      image_urls: filteredImageUrls,
      cover_image: filteredImageUrls[0] || undefined,
    };

    await createBusiness(businessData, businessToEdit?.id, validImageFiles);
    setLoading(false);
    handleOpenChange(false);
    onCreated?.(businessToEdit?.id);
  }

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (externalOpen !== undefined) {
        onOpenChange?.(newOpen);
      } else {
        setInternalOpen(newOpen);
        onOpenChange?.(newOpen);
      }
      if (!newOpen) {
        form.reset();
        setRemovedImageIndexes([]);
        setHoursDays([]);
        setOpenTime("");
        setCloseTime("");
        setActiveStep(1);
      }
    },
    [onOpenChange, externalOpen, form]
  );

  const goToNextStep = async () => {
    const step1Valid = await form.trigger(["name", "mode", "category", "description", "location"]);
    if (step1Valid) {
      setActiveStep(2);
    }
  };

  const finalTitle = isEditMode ? "Edit Business" : "Create Business";
  const finalSubtitle = isEditMode
    ? "Update your business details, operating hours, and media."
    : "List your business to get discovered by nearby customers.";

  const Trigger = React.forwardRef<HTMLButtonElement, React.HTMLAttributes<HTMLButtonElement>>(
    (props, ref) => (
      <button
        ref={ref}
        {...props}
        type="button"
        className="flex items-center gap-2 h-11 px-5 rounded-full font-sans font-semibold text-sm text-foreground bg-primary hover:opacity-90 transition-all active:scale-95 shadow-md"
      >
        <Briefcase className="w-4 h-4" />
        <span>Add Business</span>
      </button>
    )
  );
  Trigger.displayName = "Trigger";

  const headerBlock = (
    <div className="relative px-5 pt-5 pb-4 sm:px-6 sm:pt-6 sm:pb-5 border-b border-border/60 bg-muted/20 flex-shrink-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0 text-primary">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-foreground font-sans tracking-tight">
                {finalTitle}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary border border-primary/20">
                {isEditMode ? "Edit" : "New"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-sans mt-0.5 max-w-sm">
              {finalSubtitle}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Step Navigation Tabs */}
      <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/40">
        <button
          type="button"
          onClick={() => setActiveStep(1)}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold font-sans transition-all",
            activeStep === 1
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
        >
          <span className="w-4 h-4 rounded-full bg-background/20 text-[10px] flex items-center justify-center font-bold">
            1
          </span>
          <span>Profile & Type</span>
        </button>
        <button
          type="button"
          onClick={goToNextStep}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold font-sans transition-all",
            activeStep === 2
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
        >
          <span className="w-4 h-4 rounded-full bg-background/20 text-[10px] flex items-center justify-center font-bold">
            2
          </span>
          <span>Media & Hours</span>
        </button>
      </div>
    </div>
  );

  const formContent = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 min-h-0">
          {/* STEP 1: Profile & Type */}
          {activeStep === 1 && (
            <div className="space-y-5 animate-in fade-in-50 duration-200">
              {/* Business Name */}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className={labelClass}>
                      <Building2 className="w-3.5 h-3.5 text-primary" />
                      <span>Business Name</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g. Acme Coffee & Bakery"
                        className={cn(inputBase, "rounded-xl h-11 px-3.5")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              {/* Business Mode Selector */}
              <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className={labelClass}>
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                      <span>Business Type</span>
                    </FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                        {BUSINESS_MODES.map((m) => {
                          const Icon = m.icon;
                          const selected = field.value === m.value;
                          return (
                            <button
                              key={m.value}
                              type="button"
                              onClick={() => field.onChange(m.value)}
                              className={cn(
                                "relative flex flex-col items-start p-3.5 rounded-2xl border text-left transition-all group",
                                selected
                                  ? "bg-primary/10 border-primary ring-1 ring-primary/30 shadow-sm"
                                  : "bg-background/40 border-border/60 hover:bg-muted/40 hover:border-border"
                              )}
                            >
                              <div className="flex items-center justify-between w-full mb-2">
                                <div
                                  className={cn(
                                    "w-8 h-8 rounded-xl flex items-center justify-center transition-colors",
                                    selected
                                      ? "bg-primary text-primary-foreground"
                                      : "bg-muted text-muted-foreground group-hover:text-foreground"
                                  )}
                                >
                                  <Icon className="w-4 h-4" />
                                </div>
                                {selected && (
                                  <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[10px]">
                                    <Check className="w-3 h-3 stroke-[3]" />
                                  </span>
                                )}
                              </div>
                              <span className="font-sans font-bold text-xs text-foreground block">
                                {m.label}
                              </span>
                              <span className="text-[11px] text-muted-foreground font-sans line-clamp-1 mt-0.5">
                                {m.description}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              {/* Category */}
              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className={labelClass}>
                      <Tag className="w-3.5 h-3.5 text-primary" />
                      <span>Category</span>
                    </FormLabel>
                    <FormControl>
                      <div className="flex flex-wrap gap-1.5">
                        {CATEGORIES.map((cat) => {
                          const active = field.value === cat;
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => field.onChange(cat)}
                              className={cn(
                                "px-3 py-1.5 rounded-full text-xs font-semibold font-sans transition-all",
                                active
                                  ? "bg-primary text-primary-foreground shadow-sm"
                                  : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40"
                              )}
                            >
                              {cat}
                            </button>
                          );
                        })}
                      </div>
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className={labelClass}>
                      <Briefcase className="w-3.5 h-3.5 text-primary" />
                      <span>About Your Business</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Tell your local neighbors what products, services, or specials you offer..."
                        className={cn(inputBase, "rounded-2xl resize-none min-h-[100px] p-3.5")}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              {/* Location */}
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className={labelClass}>
                      <MapPin className="w-3.5 h-3.5 text-primary" />
                      <span>Physical Address / Neighborhood</span>
                    </FormLabel>
                    <FormControl>
                      <div className="[&_input]:bg-background/80 [&_input]:border-border/80 [&_input]:rounded-xl [&_input]:text-foreground [&_input]:placeholder:text-muted-foreground/70 [&_input]:h-11">
                        <LocationInput
                          name={field.name}
                          control={form.control}
                          defaultValue={field.value}
                          placeholder="Search or enter location address..."
                        />
                      </div>
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />
            </div>
          )}

          {/* STEP 2: Media & Hours */}
          {activeStep === 2 && (
            <div className="space-y-5 animate-in fade-in-50 duration-200">
              {/* Business Photos Upload */}
              <FormField
                control={form.control}
                name="image"
                render={({ field: { onChange, value, ...rest } }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className={labelClass}>
                      <ImageIcon className="w-3.5 h-3.5 text-primary" />
                      <span>Business Photos</span>
                    </FormLabel>
                    <FormControl>
                      <label
                        className={cn(
                          "relative flex flex-col items-center justify-center p-5 rounded-2xl border-2 border-dashed border-border/80 hover:border-primary/60 bg-muted/20 hover:bg-muted/40 cursor-pointer text-center transition-all group"
                        )}
                      >
                        <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                          <UploadCloud className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-semibold text-foreground font-sans">
                          Click to upload photos
                        </span>
                        <span className="text-[11px] text-muted-foreground font-sans mt-0.5">
                          High resolution JPEG or PNG photos recommended
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="sr-only"
                          onChange={(e) => onChange(e.target.files ?? undefined)}
                          {...rest}
                        />
                      </label>
                    </FormControl>

                    {/* Previews */}
                    {((value && value.length > 0) ||
                      (businessToEdit?.image_urls &&
                        businessToEdit.image_urls.filter((_, i) => !removedImageIndexes.includes(i)).length > 0)) && (
                      <div className="grid grid-cols-4 gap-2 pt-2">
                        {businessToEdit?.image_urls?.map((url, index) => {
                          if (removedImageIndexes.includes(index)) return null;
                          return (
                            <div
                              key={`url-${index}`}
                              className="relative aspect-square rounded-xl overflow-hidden border border-border bg-background group"
                            >
                              <Image
                                src={url}
                                alt=""
                                fill
                                className="object-cover"
                              />
                              {index === 0 && (
                                <span className="absolute bottom-1 left-1 bg-black/60 backdrop-blur-md text-white text-[9px] px-1.5 py-0.5 rounded font-semibold">
                                  Cover
                                </span>
                              )}
                              <button
                                type="button"
                                className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center bg-destructive text-destructive-foreground opacity-90 hover:opacity-100 transition-opacity"
                                onClick={() => setRemovedImageIndexes((prev) => [...prev, index])}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })}
                        {value &&
                          Array.from(value).map((file, index) => (
                            <div
                              key={`file-${index}`}
                              className="relative aspect-square rounded-xl overflow-hidden border border-border bg-background group"
                            >
                              <BlobImage file={file as File} className="w-full h-full object-cover" />
                              <button
                                type="button"
                                className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center bg-destructive text-destructive-foreground opacity-90 hover:opacity-100 transition-opacity"
                                onClick={() => {
                                  const dt = new DataTransfer();
                                  Array.from(value).forEach((f, i) => {
                                    if (i !== index) dt.items.add(f as File);
                                  });
                                  onChange(dt.files.length ? dt.files : undefined);
                                }}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              {/* Operating Hours */}
              <FormField
                control={form.control}
                name="hours"
                render={() => (
                  <FormItem className="space-y-2">
                    <FormLabel className={labelClass}>
                      <Clock className="w-3.5 h-3.5 text-primary" />
                      <span>Operating Hours</span>
                    </FormLabel>
                    <FormControl>
                      <div className="space-y-3 p-4 rounded-2xl border border-border/80 bg-background/50">
                        {/* Preset Buttons */}
                        <div className="flex items-center justify-between gap-2 pb-1 border-b border-border/40">
                          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Select Days
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setHoursDays(["Mon", "Tue", "Wed", "Thu", "Fri"])}
                              className="text-[11px] text-primary hover:underline font-semibold"
                            >
                              Mon-Fri
                            </button>
                            <span className="text-muted-foreground/40 text-[10px]">•</span>
                            <button
                              type="button"
                              onClick={() => setHoursDays([...WEEK_DAYS])}
                              className="text-[11px] text-primary hover:underline font-semibold"
                            >
                              All Week
                            </button>
                            <span className="text-muted-foreground/40 text-[10px]">•</span>
                            <button
                              type="button"
                              onClick={() => setHoursDays([])}
                              className="text-[11px] text-muted-foreground hover:text-foreground font-semibold"
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        {/* Day Pills */}
                        <div className="flex flex-wrap gap-1.5">
                          {WEEK_DAYS.map((day) => {
                            const active = hoursDays.includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() =>
                                  setHoursDays((prev) =>
                                    active ? prev.filter((d) => d !== day) : [...prev, day]
                                  )
                                }
                                className={cn(
                                  "flex-1 min-w-[40px] h-9 rounded-xl text-xs font-bold font-sans transition-all",
                                  active
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "bg-muted/40 text-muted-foreground hover:bg-muted border border-border/40"
                                )}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>

                        {/* Times */}
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <div>
                            <label className="text-[11px] text-muted-foreground font-sans block mb-1">
                              Opens at
                            </label>
                            <input
                              type="time"
                              value={openTime}
                              onChange={(e) => setOpenTime(e.target.value)}
                              className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                          </div>
                          <div>
                            <label className="text-[11px] text-muted-foreground font-sans block mb-1">
                              Closes at
                            </label>
                            <input
                              type="time"
                              value={closeTime}
                              onChange={(e) => setCloseTime(e.target.value)}
                              className="w-full h-10 px-3 rounded-xl border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                            />
                          </div>
                        </div>

                        {/* Preview */}
                        {hoursDays.length > 0 && openTime && closeTime && (
                          <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-xs font-semibold text-primary flex items-center gap-2">
                            <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{formatHours(hoursDays, openTime, closeTime)}</span>
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage className="text-red-400 text-xs" />
                  </FormItem>
                )}
              />

              {/* Contact Info Group */}
              <div className="space-y-4 pt-1">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-sans">
                  Contact Information
                </h4>

                {/* Phone */}
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className={labelClass}>
                        <Phone className="w-3.5 h-3.5 text-primary" />
                        <span>Phone Number (Optional)</span>
                      </FormLabel>
                      <FormControl>
                        <div className="flex items-center rounded-xl border border-border bg-background overflow-hidden h-11 focus-within:ring-2 focus-within:ring-primary/40">
                          <span className="px-3.5 text-xs font-semibold text-muted-foreground border-r border-border h-full flex items-center flex-shrink-0 bg-muted/20">
                            +234
                          </span>
                          <input
                            type="tel"
                            inputMode="numeric"
                            placeholder="8012345678"
                            className="flex-1 h-full px-3.5 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
                            value={field.value?.startsWith("+234") ? field.value.slice(4) : field.value || ""}
                            onChange={(e) => {
                              const digits = e.target.value.replace(/\D/g, "");
                              field.onChange(digits ? `+234${digits}` : "");
                            }}
                          />
                        </div>
                      </FormControl>
                      <FormMessage className="text-red-400 text-xs" />
                    </FormItem>
                  )}
                />

                {/* Email */}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className={labelClass}>
                        <Mail className="w-3.5 h-3.5 text-primary" />
                        <span>Email Address (Optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="e.g. contact@gmail.com"
                          className={cn(inputBase, "rounded-xl h-11 px-3.5")}
                          {...field}
                        />
                      </FormControl>
                      <p className="text-[11px] text-muted-foreground font-sans">Must be a @gmail.com address</p>
                      <FormMessage className="text-red-400 text-xs" />
                    </FormItem>
                  )}
                />

                {/* Website */}
                <FormField
                  control={form.control}
                  name="website"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className={labelClass}>
                        <Globe className="w-3.5 h-3.5 text-primary" />
                        <span>Website Link (Optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://yourwebsite.com"
                          className={cn(inputBase, "rounded-xl h-11 px-3.5")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-red-400 text-xs" />
                    </FormItem>
                  )}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-5 sm:p-6 pt-3 border-t border-border/60 bg-muted/20 flex items-center justify-between gap-3 flex-shrink-0">
          {activeStep === 1 ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="rounded-xl h-11 px-4 text-xs font-semibold"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={goToNextStep}
                className="rounded-xl h-11 px-6 text-xs font-semibold gap-1.5 bg-primary text-primary-foreground hover:opacity-90"
              >
                <span>Continue to Media</span>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setActiveStep(1)}
                className="rounded-xl h-11 px-4 text-xs font-semibold gap-1"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-xl h-11 font-sans font-bold text-xs bg-primary text-primary-foreground hover:opacity-90 shadow-md"
              >
                {loading
                  ? isEditMode
                    ? "Saving Changes..."
                    : "Creating Business..."
                  : isEditMode
                  ? "Save Changes"
                  : "Complete Business Profile"}
              </Button>
            </>
          )}
        </div>
      </form>
    </Form>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        {externalOpen === undefined && (
          <SheetTrigger asChild>{children ? children : <Trigger />}</SheetTrigger>
        )}
        <SheetContent
          side="bottom"
          className="p-0 flex flex-col max-h-[92dvh] rounded-t-[28px] border-t border-border/80 bg-card text-foreground overflow-hidden"
          style={{ zIndex: 110 }}
          hideClose
        >
          <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full mx-auto my-2 flex-shrink-0" />
          {headerBlock}
          <div
            className="flex-1 flex flex-col min-h-0 overflow-y-auto"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            {formContent}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {externalOpen === undefined && (
        <DialogTrigger asChild>{children ? children : <Trigger />}</DialogTrigger>
      )}
      <DialogContent
        className={cn(
          "sm:max-w-[640px] p-0 flex flex-col max-h-[88dvh] border border-border/80 rounded-[28px] bg-card text-foreground gap-0 overflow-hidden shadow-2xl backdrop-blur-xl"
        )}
        style={{ zIndex: 110 }}
        hideClose
      >
        {headerBlock}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">{formContent}</div>
      </DialogContent>
    </Dialog>
  );
});

CreateBusinessDialogComponent.displayName = "CreateBusinessDialogComponent";

export const CreateBusinessDialog = CreateBusinessDialogComponent;