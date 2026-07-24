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
import { Briefcase, X } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useState, useEffect, memo, useCallback, useMemo } from "react";
import * as React from "react";
import { LocationInput, LocationValue } from "./LocationInput";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePosts } from "@/hooks/use-posts";
import type { Business } from "@/types";
import Image from "next/image";
import { cn } from "@/lib/utils";

const inputBase =
  "bg-background border border-primary text-foreground placeholder:text-muted-foreground placeholder:italic font-sans text-xs focus-visible:ring-primary focus-visible:ring-offset-0";
const labelClass = "font-sans font-semibold text-xs text-foreground";
const pointerClass = "w-2 h-2 border-b border-l border-primary rounded-bl-md flex-shrink-0 mt-1.5";

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function formatTime12h(time24: string): string {
  if (!time24) return "";
  const [hStr, mStr] = time24.split(":");
  let h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${mStr} ${period}`;
}

// Groups selected days into contiguous ranges (e.g. Mon,Tue,Wed,Fri -> "Mon-Wed, Fri")
// and combines with the open/close time into a single human-readable hours string.
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

// Best-effort parse of a previously saved hours string like
// "Mon-Fri 9:00 AM-6:00 PM" back into day/time picker state (edit mode).
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
    }, "At least one image is required."),
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
  const [removedImageIndexes, setRemovedImageIndexes] = useState<number[]>([]);
  const [hoursDays, setHoursDays] = useState<string[]>([]);
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");
  const isMobile = useIsMobile();
  const isEditMode = !!businessToEdit;

  const open = externalOpen !== undefined ? externalOpen : internalOpen;

  const formSchema = useMemo(() => getFormSchema(isEditMode, businessToEdit), [isEditMode, businessToEdit]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
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

  // Keep the hidden `hours` form field in sync with the day/time picker.
  useEffect(() => {
    form.setValue("hours", formatHours(hoursDays, openTime, closeTime), { shouldValidate: false });
  }, [hoursDays, openTime, closeTime, form]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (isEditMode && businessToEdit) {
          stableFormReset({
            name: businessToEdit.name,
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
      }
    },
    [onOpenChange, externalOpen, form]
  );

  const finalTitle = isEditMode ? "Edit Business" : "Add Your Business";
  const finalDescription = isEditMode
    ? "Make changes to your business listing."
    : "List your business for your neighborhood to discover.";

  const Trigger = React.forwardRef<HTMLButtonElement, React.HTMLAttributes<HTMLButtonElement>>(
    (props, ref) => (
      <button
        ref={ref}
        {...props}
        type="button"
        className="flex items-center gap-2 h-11 px-5 rounded-full font-sans font-semibold text-sm text-foreground transition-all active:scale-95"
        style={{ background: "hsl(var(--primary))" }}
      >
        <Briefcase className="w-4 h-4" />
        Add Business
      </button>
    )
  );
  Trigger.displayName = "Trigger";

  const headerBlock = (
    <div className="flex items-start justify-between gap-4 p-5 sm:p-6 pb-2 flex-shrink-0">
      <div>
        <h2 className="text-lg font-normal text-muted-foreground" style={{ fontFamily: "var(--font-jersey25)" }}>
          {finalTitle}
        </h2>
        <p className="font-sans font-light italic text-xs text-foreground mt-0.5">{finalDescription}</p>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "hsl(var(--primary))" }}
        >
          <Briefcase className="w-5 h-5 text-foreground" />
        </div>
        <button
          type="button"
          onClick={() => handleOpenChange(false)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );

  const formContent = (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 min-h-0">
          <div className="space-y-4 max-w-4xl mx-auto">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Business Name</FormLabel>
                  </div>
                  <FormControl>
                    <Input placeholder="e.g The Daily Grind" className={cn(inputBase, "rounded-full h-10")} {...field} />
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Category</FormLabel>
                  </div>
                  <FormControl>
                    <Input placeholder="e.g Cafe, Beauty, Retail" className={cn(inputBase, "rounded-full h-10")} {...field} />
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Description</FormLabel>
                  </div>
                  <FormControl>
                    <Textarea
                      placeholder="Tell your neighbors what you offer"
                      className={cn(inputBase, "rounded-xl resize-none min-h-[100px]")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="location"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Location</FormLabel>
                  </div>
                  <FormControl>
                    <div
                      className={cn(
                        "[&_input]:bg-background [&_input]:border-primary [&_input]:rounded-full [&_input]:text-foreground [&_input]:placeholder:text-muted-foreground [&_input]:h-10"
                      )}
                    >
                      <LocationInput name={field.name} control={form.control} defaultValue={field.value} />
                    </div>
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Phone</FormLabel>
                  </div>
                  <FormControl>
                    <div className="flex items-center rounded-full border border-primary bg-background overflow-hidden h-10">
                      <span className="px-3 text-xs font-semibold text-muted-foreground border-r border-primary/40 h-full flex items-center flex-shrink-0">
                        +234
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        placeholder="8012345678"
                        className="flex-1 h-full px-3 bg-transparent text-xs text-foreground placeholder:text-muted-foreground placeholder:italic focus:outline-none"
                        value={field.value?.startsWith("+234") ? field.value.slice(4) : field.value || ""}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, "");
                          field.onChange(digits ? `+234${digits}` : "");
                        }}
                      />
                    </div>
                  </FormControl>
                  <p className="text-[0.6875rem] text-muted-foreground font-sans">Nigerian numbers only, e.g. +2348012345678</p>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            {/* Modern hours picker: day toggles + open/close time */}
            <FormField
              control={form.control}
              name="hours"
              render={() => (
                <FormItem className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Hours</FormLabel>
                  </div>
                  <FormControl>
                    <div className="space-y-3 p-3 rounded-2xl border border-primary/40 bg-background">
                      {/* Day pills */}
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
                                "w-9 h-9 rounded-full text-[0.6875rem] font-bold font-sans transition-colors",
                                active
                                  ? "text-foreground"
                                  : "text-muted-foreground bg-transparent border border-primary/40"
                              )}
                              style={active ? { background: "hsl(var(--primary))" } : undefined}
                            >
                              {day.slice(0, 2)}
                            </button>
                          );
                        })}
                      </div>

                      {/* Time range */}
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <label className="text-[0.6875rem] text-muted-foreground font-sans block mb-1">Opens at</label>
                          <input
                            type="time"
                            value={openTime}
                            onChange={(e) => setOpenTime(e.target.value)}
                            className="w-full h-10 px-3 rounded-full border border-primary bg-background text-xs text-foreground focus:outline-none"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[0.6875rem] text-muted-foreground font-sans block mb-1">Closes at</label>
                          <input
                            type="time"
                            value={closeTime}
                            onChange={(e) => setCloseTime(e.target.value)}
                            className="w-full h-10 px-3 rounded-full border border-primary bg-background text-xs text-foreground focus:outline-none"
                          />
                        </div>
                      </div>

                      {hoursDays.length > 0 && openTime && closeTime && (
                        <p className="text-[0.6875rem] text-primary font-sans font-semibold">
                          {formatHours(hoursDays, openTime, closeTime)}
                        </p>
                      )}
                    </div>
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Email</FormLabel>
                  </div>
                  <FormControl>
                    <Input placeholder="e.g yourbusiness@gmail.com" className={cn(inputBase, "rounded-full h-10")} {...field} />
                  </FormControl>
                  <p className="text-[0.6875rem] text-muted-foreground font-sans">Must be a @gmail.com address</p>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="website"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Website</FormLabel>
                  </div>
                  <FormControl>
                    <Input placeholder="Optional" className={cn(inputBase, "rounded-full h-10")} {...field} />
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="image"
              render={({ field: { onChange, value, ...rest } }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Business Photos</FormLabel>
                  </div>
                  <FormControl>
                    <label
                      className={cn(
                        "flex items-center gap-2 rounded-[5px] border border-primary bg-background px-4 py-3 cursor-pointer text-foreground font-sans text-xs font-semibold italic"
                      )}
                    >
                      <span>Choose Files</span>
                      <span className="font-normal text-muted-foreground">
                        {value && value.length > 0 ? `${value.length} file(s)` : "No file chosen"}
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
                  {(value && value.length > 0) ||
                  (businessToEdit?.image_urls &&
                    businessToEdit.image_urls.filter((_, i) => !removedImageIndexes.includes(i)).length > 0) ? (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {businessToEdit?.image_urls?.map((url, index) => {
                        if (removedImageIndexes.includes(index)) return null;
                        return (
                          <div key={`url-${index}`} className="relative w-14 h-14 rounded overflow-hidden bg-background flex-shrink-0">
                            <Image src={url} alt="" width={56} height={56} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              className="absolute top-0 right-0 w-5 h-5 rounded-full flex items-center justify-center bg-[#FF383C] border border-border"
                              onClick={() => setRemovedImageIndexes((prev) => [...prev, index])}
                            >
                              <X className="w-3 h-3 text-foreground" />
                            </button>
                          </div>
                        );
                      })}
                      {value &&
                        Array.from(value).map((file, index) => (
                          <div key={`file-${index}`} className="relative w-14 h-14 rounded overflow-hidden bg-background flex-shrink-0">
                            <BlobImage file={file as File} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              className="absolute top-0 right-0 w-5 h-5 rounded-full flex items-center justify-center bg-[#FF383C] border border-border"
                              onClick={() => {
                                const dt = new DataTransfer();
                                Array.from(value).forEach((f, i) => {
                                  if (i !== index) dt.items.add(f as File);
                                });
                                onChange(dt.files.length ? dt.files : undefined);
                              }}
                            >
                              <X className="w-3 h-3 text-foreground" />
                            </button>
                          </div>
                        ))}
                    </div>
                  ) : null}
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />
          </div>
        </div>
        <div className="p-5 sm:p-6 pt-0 flex-shrink-0">
          <Button
            type="submit"
            className="w-full rounded-full h-12 font-sans font-medium text-sm text-foreground"
            style={{ background: "hsl(var(--primary))" }}
            disabled={loading}
          >
            {loading ? (isEditMode ? "Saving..." : "Adding Business...") : isEditMode ? "Save Changes" : "Add Business"}
          </Button>
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
          className="p-0 flex flex-col max-h-[92dvh] rounded-t-[32px] border border-border bg-card text-foreground overflow-hidden"
          style={{ zIndex: 110 }}
          hideClose
        >
          {headerBlock}
          <div
            className="flex-1 flex flex-col min-h-0 overflow-y-auto"
            style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
          >
            {formContent}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {externalOpen === undefined && <DialogTrigger asChild>{children ? children : <Trigger />}</DialogTrigger>}
      <DialogContent
        className={cn("sm:max-w-[626px] p-0 flex flex-col max-h-[90dvh] border border-border rounded-[24px] bg-card text-foreground gap-0 overflow-hidden")}
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