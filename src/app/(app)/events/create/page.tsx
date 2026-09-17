"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useCategories } from "@/hooks/use-categories";
import { supabase } from "@/lib/supabase";
import { ModerationService } from "@/lib/moderation-service";
import { LocationInput, StructuredLocation } from "@/components/LocationInput";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ImageIcon,
  Video,
  X,
  Loader2,
  CheckCircle2,
  Clock,
  Globe,
  Users,
  ChevronRight,
  ChevronLeft,
  Calendar,
  MapPin,
  Ticket as TicketIcon,
  Plus,
  AlertTriangle,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const STEPS = ["Basic Info", "Date & Time", "Location", "Tickets", "Media", "Review"];

export interface TicketTierInput {
  id: string;
  name: string;
  price: number;
  capacity: number | null;
  isFree: boolean;
}

export default function CreateEventPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const { categories, loading: categoriesLoading } = useCategories("event");

  const [step, setStep] = useState(0);

  // Step 1: Basic Info
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");

  // Step 2: Date & Time
  const [eventDate, setEventDate] = useState("");
  const [startTimeStr, setStartTimeStr] = useState("10:00");
  const [endTimeStr, setEndTimeStr] = useState("18:00");

  // Step 3: Location
  const [locationOnline, setLocationOnline] = useState(false);
  const [onlineLink, setOnlineLink] = useState("");
  const [locationAddress, setLocationAddress] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<StructuredLocation | null>(null);

  // Step 4: Tickets & Payout Gate
  const [ticketTiers, setTicketTiers] = useState<TicketTierInput[]>([
    { id: "1", name: "General Admission", price: 0, capacity: 100, isFree: true },
  ]);
  const [hasSellerAccount, setHasSellerAccount] = useState<boolean | null>(null);
  const [checkingSeller, setCheckingSeller] = useState(false);

  // Step 5: Media (Photos & Videos)
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [coverIndex, setCoverIndex] = useState(0);

  // Memoized Object URLs for attached image files with automatic cleanup to prevent memory leaks
  const imagePreviews = useMemo(() => {
    return imageFiles.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
  }, [imageFiles]);

  useEffect(() => {
    return () => {
      imagePreviews.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [imagePreviews]);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  // Step 6: Review & Submission State
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [moderationStatus, setModerationStatus] = useState<"approved" | "pending">("approved");

  // Check seller payout account status
  const checkSellerAccount = async () => {
    setCheckingSeller(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/seller/setup-account", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setHasSellerAccount(!!data?.account);
    } catch {
      setHasSellerAccount(false);
    } finally {
      setCheckingSeller(false);
    }
  };

  useEffect(() => {
    checkSellerAccount();
  }, []);

  // Handlers for Ticket Tiers
  const addTicketTier = () => {
    const newTier: TicketTierInput = {
      id: Date.now().toString(),
      name: "VIP",
      price: 5000,
      capacity: 50,
      isFree: false,
    };
    setTicketTiers((prev) => [...prev, newTier]);
  };

  const removeTicketTier = (id: string) => {
    if (ticketTiers.length === 1) {
      toast({ variant: "destructive", title: "Tier Required", description: "Event must have at least one ticket tier." });
      return;
    }
    setTicketTiers((prev) => prev.filter((t) => t.id !== id));
  };

  const updateTicketTier = (id: string, updates: Partial<TicketTierInput>) => {
    setTicketTiers((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  };

  // Image Handlers
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);
    const available = 10 - imageFiles.length;
    if (available <= 0) {
      toast({ variant: "destructive", title: "Limit Reached", description: "Maximum 10 photos allowed." });
      return;
    }
    setImageFiles((prev) => [...prev, ...selected.slice(0, available)]);
  };

  const removeImage = (index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    if (coverIndex === index) setCoverIndex(0);
    else if (coverIndex > index) setCoverIndex((prev) => prev - 1);
  };

  // Video Handlers
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

  const removeVideo = (index: number) => {
    setVideoFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Build combined ISO strings for dates
  const buildIsoString = (dateStr: string, timeStr: string) => {
    if (!dateStr) return new Date().toISOString();
    const [hours, minutes] = timeStr.split(":");
    const d = new Date(dateStr);
    d.setHours(parseInt(hours || "0", 10), parseInt(minutes || "0", 10), 0, 0);
    return d.toISOString();
  };

  const hasPaidTiers = ticketTiers.some((t) => !t.isFree && t.price > 0);

  // Submit Handler
  const handleSubmit = async () => {
    if (!user) {
      toast({ variant: "destructive", title: "Authentication Required", description: "Please sign in to create events." });
      return;
    }

    if (hasPaidTiers && !hasSellerAccount) {
      toast({
        variant: "destructive",
        title: "Payout Account Required",
        description: "Please link a bank account before creating paid ticket events.",
      });
      return;
    }

    setSubmitting(true);
    setUploadProgress(10);

    try {
      // 1. Upload Images to 'post-images' bucket
      const uploadedImageUrls: string[] = [];
      const reorderedFiles = [...imageFiles];
      if (coverIndex > 0 && coverIndex < reorderedFiles.length) {
        const [cover] = reorderedFiles.splice(coverIndex, 1);
        reorderedFiles.unshift(cover);
      }

      for (let i = 0; i < reorderedFiles.length; i++) {
        const file = reorderedFiles[i];
        const safeName = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
        const path = `${user.id}/events/${Date.now()}_${i}_${safeName}`;

        const { error: uploadErr } = await supabase.storage
          .from("post-images")
          .upload(path, file, { contentType: file.type || "image/jpeg", cacheControl: "604800", upsert: false });

        if (uploadErr) throw uploadErr;

        const { data: pubData } = supabase.storage.from("post-images").getPublicUrl(path);
        if (pubData?.publicUrl) uploadedImageUrls.push(pubData.publicUrl);
        setUploadProgress(10 + Math.round(((i + 1) / (reorderedFiles.length + videoFiles.length || 1)) * 35));
      }

      // 2. Upload Videos to 'post-videos' bucket
      const uploadedVideoUrls: string[] = [];
      for (let i = 0; i < videoFiles.length; i++) {
        const file = videoFiles[i];
        const safeName = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
        const path = `${user.id}/events/${Date.now()}_${i}_${safeName}`;

        const { error: uploadErr } = await supabase.storage
          .from("post-videos")
          .upload(path, file, { contentType: file.type || "video/mp4", cacheControl: "604800", upsert: false });

        if (uploadErr) throw uploadErr;

        const { data: pubData } = supabase.storage.from("post-videos").getPublicUrl(path);
        if (pubData?.publicUrl) uploadedVideoUrls.push(pubData.publicUrl);
        setUploadProgress(45 + Math.round(((i + 1) / videoFiles.length) * 25));
      }

      setUploadProgress(70);

      // 3. Client-side Moderation Check
      const textToModerate = [title.trim(), description.trim()].filter(Boolean).join(" ");
      let modStatus: "approved" | "pending" = "approved";
      let modReason = "";

      if (textToModerate) {
        const textMod = await ModerationService.checkText(textToModerate);
        if (!textMod.isSafe) {
          modStatus = "pending";
          modReason = textMod.reason || "Flagged content";
        }
      }

      setUploadProgress(85);

      const startTimeIso = buildIsoString(eventDate, startTimeStr);
      const endTimeIso = buildIsoString(eventDate, endTimeStr);

      const payload = {
        title: title.trim(),
        description: description.trim(),
        category: category,
        coverImageUrl: uploadedImageUrls[0] || null,
        imageUrls: uploadedImageUrls,
        videoUrls: uploadedVideoUrls,
        locationOnline,
        onlineLink: locationOnline ? onlineLink.trim() : null,
        locationAddress: locationOnline ? null : locationAddress.trim(),
        lat: locationOnline ? null : selectedLocation?.lat || null,
        lng: locationOnline ? null : selectedLocation?.lng || null,
        ward: locationOnline ? null : selectedLocation?.ward || null,
        lga: locationOnline ? null : selectedLocation?.lga || null,
        state: locationOnline ? null : selectedLocation?.state || null,
        startTime: startTimeIso,
        endTime: endTimeIso,
        visibility,
        publish: modStatus === "approved",
        status: modStatus === "pending" ? "PENDING_MODERATION" : "PUBLISHED",
        ticketTiers: ticketTiers.map((t) => ({
          name: t.name,
          price: t.isFree ? 0 : Number(t.price) || 0,
          capacity: t.capacity ? Number(t.capacity) : null,
        })),
      };

      // 4. POST to /api/events/create API
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/events/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (!res.ok || resData.error) {
        throw new Error(resData.error || resData.message || "Failed to create event");
      }

      // 5. Insert into moderation_queue if flagged
      if (modStatus === "pending" && resData.eventId) {
        await supabase.from("moderation_queue").insert({
          content_id: resData.eventId,
          table_name: "events",
          user_id: user.id,
          status: "pending",
          reason: modReason,
          text_content: textToModerate,
          image_urls: uploadedImageUrls,
        });
      }

      setSubmitting(false);
      setUploadProgress(100);
      setModerationStatus(modStatus);
      setSubmitted(true);
    } catch (err: any) {
      setSubmitting(false);
      setUploadProgress(0);
      console.error("Event creation error:", err);
      toast({
        variant: "destructive",
        title: "Creation Error",
        description: err?.message || "Failed to create event. Please try again.",
      });
    }
  };

  // ── Success State Screen ──────────────────────────────────────────
  if (submitted) {
    if (moderationStatus === "pending") {
      return (
        <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold font-sans text-foreground mb-2">Sent for Moderation</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Your event details were flagged and sent for admin review. It will be published once approved.
          </p>
          <Button
            onClick={() => router.push("/events")}
            className="rounded-full px-8 bg-primary text-foreground font-sans font-bold hover:bg-primary/90"
          >
            Back to Events
          </Button>
        </div>
      );
    }

    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>
        <h1 className="text-2xl font-bold font-sans text-foreground mb-2">Event Published!</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Your event is live and available for ticket bookings in your community.
        </p>
        <Button
          onClick={() => router.push("/events")}
          className="rounded-full px-8 bg-primary text-foreground font-sans font-bold hover:bg-primary/90"
        >
          Explore Events
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (step > 0) setStep(step - 1);
                else router.back();
              }}
              className="w-11 h-11 rounded-full hover:bg-secondary shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-bold font-sans text-foreground">Create Event</h1>
          </div>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-secondary text-secondary-foreground">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </span>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Form Wizard Column */}
          <div className={cn("space-y-6", step === 5 ? "md:col-span-6" : "md:col-span-7")}>
            {/* Step Indicators */}
            <div className="flex items-center justify-between gap-1 border-b border-border pb-4 overflow-x-auto scrollbar-none">
              {STEPS.map((sName, idx) => (
                <div
                  key={sName}
                  onClick={() => idx < step && setStep(idx)}
                  className={cn(
                    "flex-1 min-h-[44px] flex items-center justify-center text-center py-2 px-1 text-[11px] font-bold font-sans rounded-xl transition-colors cursor-pointer border whitespace-nowrap",
                    step === idx
                      ? "bg-primary text-foreground border-primary"
                      : idx < step
                      ? "bg-secondary text-secondary-foreground border-transparent hover:border-border"
                      : "bg-muted/30 text-muted-foreground border-transparent"
                  )}
                >
                  {idx + 1}. {sName}
                </div>
              ))}
            </div>

            {/* STEP 0: BASIC INFO */}
            {step === 0 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Basic Info</h2>
                  <p className="text-sm text-muted-foreground">Title, category, and event description.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Title *</label>
                  <Input
                    placeholder="e.g. Lekki Neighborhood BBQ & Music Fest"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={100}
                    className="rounded-xl min-h-[44px]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Category *</label>
                  {categoriesLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading categories...
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {categories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setCategory(cat.name)}
                          className={cn(
                            "min-h-[44px] inline-flex items-center justify-center px-4 py-2.5 rounded-full text-xs font-semibold border transition-all",
                            category === cat.name
                              ? "bg-primary text-foreground border-primary"
                              : "bg-secondary/50 text-secondary-foreground border-border hover:bg-secondary"
                          )}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
                  <Textarea
                    placeholder="Describe what attendees can expect, rules, schedule..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={2000}
                    rows={5}
                    className="rounded-xl resize-none"
                  />
                </div>

                <Button
                  onClick={() => {
                    if (!title.trim()) {
                      toast({ variant: "destructive", title: "Title Required", description: "Please enter an event title." });
                      return;
                    }
                    if (!category) {
                      toast({ variant: "destructive", title: "Category Required", description: "Please select an event category." });
                      return;
                    }
                    setStep(1);
                  }}
                  className="w-full min-h-[44px] rounded-full py-3.5 font-sans font-bold bg-primary text-foreground hover:bg-primary/90 text-base"
                >
                  Continue to Date & Time
                  <ChevronRight className="w-5 h-5 ml-1" />
                </Button>
              </div>
            )}

            {/* STEP 1: DATE & TIME */}
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Date & Time</h2>
                  <p className="text-sm text-muted-foreground">Set when your event starts and finishes.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Event Date *</label>
                  <Input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="rounded-xl min-h-[44px]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Start Time *</label>
                    <Input
                      type="time"
                      value={startTimeStr}
                      onChange={(e) => setStartTimeStr(e.target.value)}
                      className="rounded-xl min-h-[44px]"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">End Time *</label>
                    <Input
                      type="time"
                      value={endTimeStr}
                      onChange={(e) => setEndTimeStr(e.target.value)}
                      className="rounded-xl min-h-[44px]"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setStep(0)} className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold">
                    <ChevronLeft className="w-5 h-5 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={() => {
                      if (!eventDate) {
                        toast({ variant: "destructive", title: "Date Required", description: "Please select an event date." });
                        return;
                      }
                      setStep(2);
                    }}
                    className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold bg-primary text-foreground hover:bg-primary/90"
                  >
                    Continue to Location
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2: LOCATION */}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Location</h2>
                  <p className="text-sm text-muted-foreground">Choose physical venue or online streaming link.</p>
                </div>

                <div className="flex rounded-full bg-secondary p-1 border border-border">
                  <button
                    type="button"
                    onClick={() => setLocationOnline(false)}
                    className={cn(
                      "flex-1 min-h-[44px] py-2.5 rounded-full text-sm font-bold font-sans transition-all flex items-center justify-center",
                      !locationOnline ? "bg-primary text-foreground shadow" : "text-muted-foreground"
                    )}
                  >
                    Venue Location
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocationOnline(true)}
                    className={cn(
                      "flex-1 min-h-[44px] py-2.5 rounded-full text-sm font-bold font-sans transition-all flex items-center justify-center",
                      locationOnline ? "bg-primary text-foreground shadow" : "text-muted-foreground"
                    )}
                  >
                    Online Event
                  </button>
                </div>

                {locationOnline ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Online Stream / Meeting Link *</label>
                    <Input
                      placeholder="https://zoom.us/j/... or Youtube Live link"
                      value={onlineLink}
                      onChange={(e) => setOnlineLink(e.target.value)}
                      className="rounded-xl min-h-[44px]"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Venue Address / Search</label>
                    <LocationInput
                      value={locationAddress}
                      onChange={setLocationAddress}
                      onLocationSelect={(loc) => {
                        setSelectedLocation(loc);
                        setLocationAddress(loc.address);
                      }}
                      placeholder="Search venue or address in Nigeria..."
                    />
                    {selectedLocation && (
                      <p className="text-xs text-emerald-500 font-medium flex items-center gap-1 mt-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Resolved: {selectedLocation.ward ? `${selectedLocation.ward}, ` : ""}{selectedLocation.lga}, {selectedLocation.state}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setStep(1)} className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold">
                    <ChevronLeft className="w-5 h-5 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={() => {
                      if (locationOnline && !onlineLink.trim()) {
                        toast({ variant: "destructive", title: "Link Required", description: "Please enter an online stream link." });
                        return;
                      }
                      if (!locationOnline && !locationAddress.trim()) {
                        toast({ variant: "destructive", title: "Address Required", description: "Please enter a venue address." });
                        return;
                      }
                      setStep(3);
                    }}
                    className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold bg-primary text-foreground hover:bg-primary/90"
                  >
                    Continue to Tickets
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3: TICKETS & PAYOUT GATE */}
            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Tickets & Pricing</h2>
                  <p className="text-sm text-muted-foreground">Create free or paid ticket tiers for attendees.</p>
                </div>

                {/* Payout Account Warning Banner if paid tiers present */}
                {hasPaidTiers && hasSellerAccount === false && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-sm">
                      <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />
                      Bank Payout Account Required
                    </div>
                    <p className="text-xs text-muted-foreground">
                      To sell paid tickets, you must link your Nigerian bank account for automated ticket revenue payouts.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => router.push("/profile/payout-settings")}
                      className="rounded-full bg-amber-500 text-black hover:bg-amber-600 font-bold text-xs min-h-[44px]"
                    >
                      Link Payout Account <ExternalLink className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </div>
                )}

                {/* Ticket Tiers List */}
                <div className="space-y-4">
                  {ticketTiers.map((tier, idx) => (
                    <div key={tier.id} className="p-4 rounded-2xl border border-border bg-card space-y-3 relative">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          Tier #{idx + 1}
                        </span>
                        {ticketTiers.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeTicketTier(tier.id)}
                            className="text-xs text-destructive hover:underline p-2 min-h-[44px] flex items-center"
                          >
                            Remove Tier
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-muted-foreground">Tier Name</label>
                          <Input
                            value={tier.name}
                            onChange={(e) => updateTicketTier(tier.id, { name: e.target.value })}
                            placeholder="e.g. Early Bird"
                            className="rounded-xl min-h-[44px]"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-muted-foreground">Capacity / Limit</label>
                          <Input
                            type="number"
                            value={tier.capacity ?? ""}
                            onChange={(e) =>
                              updateTicketTier(tier.id, {
                                capacity: e.target.value ? parseInt(e.target.value, 10) : null,
                              })
                            }
                            placeholder="Unlimited"
                            className="rounded-xl min-h-[44px]"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold min-h-[44px]">
                          <input
                            type="checkbox"
                            checked={tier.isFree}
                            onChange={(e) =>
                              updateTicketTier(tier.id, {
                                isFree: e.target.checked,
                                price: e.target.checked ? 0 : tier.price || 1000,
                              })
                            }
                            className="rounded text-primary focus:ring-primary w-4 h-4"
                          />
                          Free Ticket
                        </label>

                        {!tier.isFree && (
                          <div className="flex items-center gap-1">
                            <span className="text-xs font-bold text-muted-foreground">₦</span>
                            <Input
                              type="number"
                              value={tier.price}
                              onChange={(e) =>
                                updateTicketTier(tier.id, { price: parseFloat(e.target.value) || 0 })
                              }
                              placeholder="1000"
                              className="w-28 rounded-xl min-h-[44px]"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={addTicketTier}
                    className="w-full min-h-[44px] rounded-full border-dashed border-border hover:border-primary font-bold text-xs"
                  >
                    <Plus className="w-4 h-4 mr-1" /> Add Another Ticket Tier
                  </Button>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setStep(2)} className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold">
                    <ChevronLeft className="w-5 h-5 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={() => {
                      if (hasPaidTiers && !hasSellerAccount) {
                        toast({
                          variant: "destructive",
                          title: "Payout Account Required",
                          description: "Please link a bank account before continuing with paid tickets.",
                        });
                        return;
                      }
                      setStep(4);
                    }}
                    className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold bg-primary text-foreground hover:bg-primary/90"
                  >
                    Continue to Media
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 4: MEDIA (PHOTOS & VIDEOS) */}
            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Add Cover, Photos & Videos</h2>
                  <p className="text-sm text-muted-foreground">
                    Upload up to 10 photos and 3 videos (40MB max each). The cover image will be displayed on event cards.
                  </p>
                </div>

                {/* Photos Section */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Photos ({imageFiles.length}/10)
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {imageFiles.map((file, idx) => (
                      <div
                        key={`${file.name}-${idx}`}
                        onClick={() => setCoverIndex(idx)}
                        className={cn(
                          "relative aspect-square rounded-2xl overflow-hidden border-2 cursor-pointer transition-all bg-secondary",
                          coverIndex === idx ? "border-primary ring-2 ring-primary/30" : "border-border"
                        )}
                      >
                        <Image src={imagePreviews[idx]?.url || ""} alt={`Photo ${idx + 1}`} fill className="object-cover" />
                        {coverIndex === idx && (
                          <div className="absolute top-2 left-2 bg-primary text-foreground text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                            Cover
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeImage(idx);
                          }}
                          className="absolute top-2 right-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                          aria-label="Remove photo"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}

                    {imageFiles.length < 10 && (
                      <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        className="aspect-square min-h-[80px] rounded-2xl border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center p-3 text-center transition-colors bg-secondary/30 hover:bg-secondary"
                      >
                        <ImageIcon className="w-6 h-6 text-muted-foreground mb-1" />
                        <span className="text-xs font-semibold text-muted-foreground">+ Add Photo</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Videos Section */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Videos ({videoFiles.length}/3)
                  </label>
                  {videoFiles.length > 0 && (
                    <div className="space-y-2">
                      {videoFiles.map((file, i) => (
                        <div
                          key={`${file.name}-${i}`}
                          className="flex items-center justify-between p-3 rounded-2xl border border-border bg-secondary/50"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Video className="w-5 h-5 text-primary shrink-0" />
                            <span className="text-xs font-medium text-foreground truncate">{file.name}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              ({(file.size / (1024 * 1024)).toFixed(1)}MB)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeVideo(i)}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Remove video"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {videoFiles.length < 3 && (
                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      className="w-full min-h-[44px] py-3 rounded-2xl border-2 border-dashed border-border hover:border-primary/50 flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground transition-colors bg-secondary/30 hover:bg-secondary"
                    >
                      <Video className="w-4 h-4 text-blue-500" />
                      <span>+ Add Video (Max 3, 40MB)</span>
                    </button>
                  )}
                </div>

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

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setStep(3)} className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold">
                    <ChevronLeft className="w-5 h-5 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={() => setStep(5)}
                    className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold bg-primary text-foreground hover:bg-primary/90"
                  >
                    Review Event
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 5: REVIEW & PUBLISH */}
            {step === 5 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Review & Publish</h2>
                  <p className="text-sm text-muted-foreground">Review your event card details before publishing.</p>
                </div>

                {/* Audience Visibility */}
                <div className="p-4 rounded-2xl bg-secondary/50 border border-border space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Audience Visibility</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setVisibility("PUBLIC")}
                      className={cn(
                        "flex-1 min-h-[44px] p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all",
                        visibility === "PUBLIC" ? "bg-primary text-foreground border-primary" : "bg-background border-border text-muted-foreground"
                      )}
                    >
                      <Globe className="w-4 h-4 text-primary" />
                      <span>Public</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibility("PRIVATE")}
                      className={cn(
                        "flex-1 min-h-[44px] p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all",
                        visibility === "PRIVATE" ? "bg-primary text-foreground border-primary" : "bg-background border-border text-muted-foreground"
                      )}
                    >
                      <Users className="w-4 h-4 text-amber-500" />
                      <span>Friends Only</span>
                    </button>
                  </div>
                </div>

                {submitting && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold text-muted-foreground">
                      <span>Publishing event...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div className="bg-primary h-2 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" disabled={submitting} onClick={() => setStep(4)} className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold">
                    <ChevronLeft className="w-5 h-5 mr-1" /> Edit Details
                  </Button>
                  <Button
                    disabled={submitting}
                    onClick={handleSubmit}
                    className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold bg-primary text-foreground hover:bg-primary/90 text-base"
                  >
                    {submitting ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Publishing...
                      </span>
                    ) : (
                      "Publish Event"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Desktop Live Card Preview */}
          <div className="hidden md:block md:col-span-5">
            <div className="sticky top-20 p-5 rounded-3xl border border-border bg-card shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Event Preview</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {category || "Social"}
                </span>
              </div>

              <div className="relative aspect-video rounded-2xl overflow-hidden bg-secondary border border-border">
                {imageFiles.length > 0 ? (
                  <Image src={imagePreviews[coverIndex]?.url || imagePreviews[0]?.url || ""} alt="Cover" fill className="object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                    <Calendar className="w-10 h-10 mb-2 opacity-40" />
                    <span className="text-xs font-medium">No cover image</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="font-bold text-lg text-foreground line-clamp-1 font-sans">{title || "Event Title"}</h3>
                
                {eventDate && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{new Date(eventDate).toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric" })} • {startTimeStr}</span>
                  </div>
                )}

                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate">{locationOnline ? `Online Stream: ${onlineLink || "Link"}` : locationAddress || "Venue Address"}</span>
                </div>

                <div className="pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Tickets:</span>
                  <div className="flex gap-1.5">
                    {ticketTiers.map((t) => (
                      <span key={t.id} className="text-xs font-bold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                        {t.isFree ? "FREE" : `₦${t.price}`}
                      </span>
                    ))}
                  </div>
                </div>

                {videoFiles.length > 0 && (
                  <div className="flex items-center gap-1 text-xs text-blue-500 font-medium pt-1">
                    <Video className="w-3.5 h-3.5" />
                    <span>{videoFiles.length} video(s) attached</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
