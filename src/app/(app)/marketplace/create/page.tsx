"use client";

import React, { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/hooks/use-supabase-auth";
import { usePosts } from "@/hooks/use-posts";
import { useCategories } from "@/hooks/use-categories";
import { supabase } from "@/lib/supabase";
import { ModerationService } from "@/lib/moderation-service";
import { LocationInput, StructuredLocation } from "@/components/LocationInput";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  ImageIcon,
  X,
  Loader2,
  CheckCircle2,
  Clock,
  Globe,
  Users,
  ChevronRight,
  ChevronLeft,
  MapPin,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const STEPS = ["Photos", "Details", "Description", "Review"];
const CONDITIONS = ["New", "Used – Like New", "Used – Good", "Fair"];

export default function CreateMarketplaceListingPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { toast } = useToast();
  const { refreshPosts } = usePosts();
  const { categories, loading: categoriesLoading } = useCategories("marketplace");

  const [step, setStep] = useState(0);

  // Form State
  const [listingType, setListingType] = useState<"For Sale" | "Giveaway">("For Sale");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [condition, setCondition] = useState("Used – Like New");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");

  // Location State
  const [locationAddress, setLocationAddress] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<StructuredLocation | null>(null);

  // Image State
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [coverIndex, setCoverIndex] = useState(0);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Submission State
  const [posting, setPosting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [posted, setPosted] = useState(false);
  const [moderationStatus, setModerationStatus] = useState<"approved" | "pending">("approved");

  // Handlers for images
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);
    const available = 10 - imageFiles.length;
    if (available <= 0) {
      toast({ variant: "destructive", title: "Limit Reached", description: "Maximum 10 photos allowed." });
      return;
    }
    const toAdd = selected.slice(0, available);
    setImageFiles((prev) => [...prev, ...toAdd]);
  };

  const removeImage = (index: number) => {
    setImageFiles((prev) => prev.filter((_, i) => i !== index));
    if (coverIndex === index) {
      setCoverIndex(0);
    } else if (coverIndex > index) {
      setCoverIndex((prev) => prev - 1);
    }
  };

  // Submit Handler
  const handleSubmit = async () => {
    if (!user) {
      toast({ variant: "destructive", title: "Authentication Required", description: "Please sign in to list items." });
      return;
    }

    if (!title.trim()) {
      toast({ variant: "destructive", title: "Title Required", description: "Please enter a title for your listing." });
      return;
    }

    if (imageFiles.length === 0) {
      toast({ variant: "destructive", title: "Photo Required", description: "Please attach at least one photo." });
      return;
    }

    setPosting(true);
    setUploadProgress(10);

    try {
      // 1. Re-order image files so cover image is at index 0
      const reorderedFiles = [...imageFiles];
      if (coverIndex > 0 && coverIndex < reorderedFiles.length) {
        const [cover] = reorderedFiles.splice(coverIndex, 1);
        reorderedFiles.unshift(cover);
      }

      // 2. Upload images to 'post-images' bucket
      const uploadedImageUrls: string[] = [];
      for (let i = 0; i < reorderedFiles.length; i++) {
        const file = reorderedFiles[i];
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${user.id}/${Date.now()}_${i}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("post-images")
          .upload(path, file, { contentType: file.type || "image/jpeg", cacheControl: "604800", upsert: true });

        if (uploadErr) throw uploadErr;

        const { data: pubData } = supabase.storage.from("post-images").getPublicUrl(path);
        if (pubData?.publicUrl) {
          uploadedImageUrls.push(pubData.publicUrl);
        }
        setUploadProgress(10 + Math.round(((i + 1) / reorderedFiles.length) * 50));
      }

      setUploadProgress(70);

      // 3. Moderate Text (title + description combined)
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

      // 4. Create Post Payload (Writing category AND sub_category separately)
      const postPayload = {
        user_id: user.id,
        author_name: profile?.name || "Seller",
        author_image: profile?.avatar_url || "",
        category: listingType === "Giveaway" ? "Giveaway" : "For Sale",
        sub_category: subCategory || (categories[0]?.name || "Other"),
        title: title.trim(),
        text: description.trim(),
        price: listingType === "Giveaway" ? 0 : parseFloat(price) || 0,
        condition: condition,
        image_urls: uploadedImageUrls,
        is_sold: false,
        visibility: visibility,
        moderation_status: modStatus,
        state: selectedLocation?.state || null,
        lga: selectedLocation?.lga || null,
        ward: selectedLocation?.ward || null,
        lat: selectedLocation?.lat || null,
        lng: selectedLocation?.lng || null,
        timestamp: new Date().toISOString(),
        liked_by: [],
        comment_count: 0,
      };

      const { data: newPost, error: insertErr } = await supabase
        .from("posts")
        .insert(postPayload)
        .select()
        .single();

      if (insertErr) throw insertErr;

      // 5. Insert into moderation_queue if flagged
      if (modStatus === "pending" && newPost) {
        await supabase.from("moderation_queue").insert({
          content_id: newPost.id,
          table_name: "posts",
          user_id: user.id,
          status: "pending",
          reason: modReason,
          text_content: textToModerate,
          image_urls: uploadedImageUrls,
        });
      }

      setPosting(false);
      setUploadProgress(100);
      setModerationStatus(modStatus);
      setPosted(true);

      if (refreshPosts) refreshPosts();
    } catch (err: any) {
      setPosting(false);
      setUploadProgress(0);
      console.error("Listing creation failed:", err);
      toast({
        variant: "destructive",
        title: "Submission Error",
        description: err?.message || "Failed to create listing. Please try again.",
      });
    }
  };

  // ── Success State Screen ──────────────────────────────────────────
  if (posted) {
    if (moderationStatus === "pending") {
      return (
        <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
          <h1 className="text-2xl font-bold font-sans text-foreground mb-2">Sent for Moderation</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Your listing was flagged and sent for admin review. It will appear in the marketplace once approved.
          </p>
          <Button
            onClick={() => router.push("/marketplace")}
            className="rounded-full px-8 bg-primary text-foreground font-sans font-bold hover:bg-primary/90"
          >
            Back to Marketplace
          </Button>
        </div>
      );
    }

    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center max-w-lg mx-auto">
        <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </div>
        <h1 className="text-2xl font-bold font-sans text-foreground mb-2">Listing Published!</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Your item is now live in your local neighborhood marketplace.
        </p>
        <Button
          onClick={() => router.push("/marketplace")}
          className="rounded-full px-8 bg-primary text-foreground font-sans font-bold hover:bg-primary/90"
        >
          View Marketplace
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
              className="rounded-full hover:bg-secondary"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-bold font-sans text-foreground">Create Listing</h1>
          </div>
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-secondary text-secondary-foreground">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </span>
        </div>
      </header>

      {/* Main Content Area: Responsive Split on Desktop */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Form Wizard Column */}
          <div className={cn("space-y-6", step === 3 ? "md:col-span-6" : "md:col-span-7")}>
            {/* Step Indicators */}
            <div className="flex items-center justify-between gap-2 border-b border-border pb-4">
              {STEPS.map((sName, idx) => (
                <div
                  key={sName}
                  onClick={() => idx < step && setStep(idx)}
                  className={cn(
                    "flex-1 text-center py-2 text-xs font-bold font-sans rounded-xl transition-colors cursor-pointer border",
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

            {/* STEP 0: PHOTOS */}
            {step === 0 && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Add Photos</h2>
                  <p className="text-sm text-muted-foreground">
                    Upload up to 10 photos. Tap an image to select it as the cover photo.
                  </p>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {imageFiles.map((file, idx) => (
                    <div
                      key={`${file.name}-${idx}`}
                      onClick={() => setCoverIndex(idx)}
                      className={cn(
                        "relative aspect-square rounded-2xl overflow-hidden border-2 cursor-pointer transition-all group bg-secondary",
                        coverIndex === idx ? "border-primary ring-2 ring-primary/30" : "border-border"
                      )}
                    >
                      <Image
                        src={URL.createObjectURL(file)}
                        alt={`Upload ${idx + 1}`}
                        fill
                        className="object-cover"
                      />
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
                        className="absolute top-2 right-2 p-1 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}

                  {imageFiles.length < 10 && (
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="aspect-square rounded-2xl border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center p-3 text-center transition-colors bg-secondary/30 hover:bg-secondary"
                    >
                      <ImageIcon className="w-6 h-6 text-muted-foreground mb-1" />
                      <span className="text-xs font-semibold text-muted-foreground">+ Add Photo</span>
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

                <Button
                  onClick={() => {
                    if (imageFiles.length === 0) {
                      toast({ variant: "destructive", title: "Photo Required", description: "Please add at least 1 photo." });
                      return;
                    }
                    setStep(1);
                  }}
                  className="w-full rounded-full py-6 font-sans font-bold bg-primary text-foreground hover:bg-primary/90 text-base"
                >
                  Continue to Details
                  <ChevronRight className="w-5 h-5 ml-1" />
                </Button>
              </div>
            )}

            {/* STEP 1: DETAILS */}
            {step === 1 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Item Details</h2>
                  <p className="text-sm text-muted-foreground">Select listing type, title, category, and condition.</p>
                </div>

                {/* For Sale vs Giveaway Toggle */}
                <div className="flex rounded-full bg-secondary p-1 border border-border">
                  <button
                    type="button"
                    onClick={() => setListingType("For Sale")}
                    className={cn(
                      "flex-1 py-2.5 rounded-full text-sm font-bold font-sans transition-all",
                      listingType === "For Sale" ? "bg-primary text-foreground shadow" : "text-muted-foreground"
                    )}
                  >
                    For Sale
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setListingType("Giveaway");
                      setPrice("0");
                    }}
                    className={cn(
                      "flex-1 py-2.5 rounded-full text-sm font-bold font-sans transition-all flex items-center justify-center gap-1.5",
                      listingType === "Giveaway" ? "bg-emerald-500 text-white shadow" : "text-muted-foreground"
                    )}
                  >
                    <Sparkles className="w-4 h-4" />
                    Giveaway (Free)
                  </button>
                </div>

                {/* Title */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Title *</label>
                  <Input
                    placeholder="e.g. iPhone 14 Pro 256GB Space Black"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={120}
                    className="rounded-xl"
                  />
                </div>

                {/* Price (Hidden if Giveaway) */}
                {listingType === "For Sale" && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Price (₦) *</label>
                    <Input
                      type="number"
                      placeholder="e.g. 250000"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="rounded-xl"
                    />
                  </div>
                )}

                {/* Sub Category Chips */}
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
                          onClick={() => setSubCategory(cat.name)}
                          className={cn(
                            "px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all",
                            subCategory === cat.name
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

                {/* Condition Selector */}
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Condition *</label>
                  <div className="flex flex-wrap gap-2">
                    {CONDITIONS.map((cond) => (
                      <button
                        key={cond}
                        type="button"
                        onClick={() => setCondition(cond)}
                        className={cn(
                          "px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all",
                          condition === cond
                            ? "bg-primary text-foreground border-primary"
                            : "bg-secondary/50 text-secondary-foreground border-border hover:bg-secondary"
                        )}
                      >
                        {cond}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setStep(0)}
                    className="flex-1 rounded-full py-6 font-bold"
                  >
                    <ChevronLeft className="w-5 h-5 mr-1" />
                    Back
                  </Button>
                  <Button
                    onClick={() => {
                      if (!title.trim()) {
                        toast({ variant: "destructive", title: "Title Required", description: "Please enter a title." });
                        return;
                      }
                      if (listingType === "For Sale" && (!price || parseFloat(price) <= 0)) {
                        toast({ variant: "destructive", title: "Valid Price Required", description: "Please enter a valid price." });
                        return;
                      }
                      setStep(2);
                    }}
                    className="flex-1 rounded-full py-6 font-bold bg-primary text-foreground hover:bg-primary/90"
                  >
                    Continue
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 2: DESCRIPTION & LOCATION */}
            {step === 2 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Description & Location</h2>
                  <p className="text-sm text-muted-foreground">Describe your item and set the neighborhood location.</p>
                </div>

                {/* Description Textarea */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
                  <Textarea
                    placeholder="Provide details about condition, reason for selling, accessories included..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={2000}
                    rows={5}
                    className="rounded-xl resize-none"
                  />
                </div>

                {/* Location Search Input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Item Location</label>
                  <LocationInput
                    value={locationAddress}
                    onChange={setLocationAddress}
                    onLocationSelect={(loc) => {
                      setSelectedLocation(loc);
                      setLocationAddress(loc.address);
                    }}
                    placeholder="Search LGA, Ward or area in Nigeria..."
                  />
                  {selectedLocation && (
                    <p className="text-xs text-emerald-500 font-medium flex items-center gap-1 mt-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Resolved: {selectedLocation.ward ? `${selectedLocation.ward}, ` : ""}{selectedLocation.lga}, {selectedLocation.state}
                    </p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="flex-1 rounded-full py-6 font-bold"
                  >
                    <ChevronLeft className="w-5 h-5 mr-1" />
                    Back
                  </Button>
                  <Button
                    onClick={() => setStep(3)}
                    className="flex-1 rounded-full py-6 font-bold bg-primary text-foreground hover:bg-primary/90"
                  >
                    Review Listing
                    <ChevronRight className="w-5 h-5 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* STEP 3: REVIEW & PUBLISH */}
            {step === 3 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-bold font-sans text-foreground">Review & Publish</h2>
                  <p className="text-sm text-muted-foreground">Review your listing card details before publishing.</p>
                </div>

                {/* Visibility Selector */}
                <div className="p-4 rounded-2xl bg-secondary/50 border border-border space-y-3">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Audience Visibility</label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setVisibility("public")}
                      className={cn(
                        "flex-1 p-3 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all",
                        visibility === "public" ? "bg-primary text-foreground border-primary" : "bg-background border-border text-muted-foreground"
                      )}
                    >
                      <Globe className="w-4 h-4 text-primary" />
                      <span>Public (Everyone)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVisibility("private")}
                      className={cn(
                        "flex-1 p-3 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all",
                        visibility === "private" ? "bg-primary text-foreground border-primary" : "bg-background border-border text-muted-foreground"
                      )}
                    >
                      <Users className="w-4 h-4 text-amber-500" />
                      <span>Friends Only</span>
                    </button>
                  </div>
                </div>

                {posting && (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs font-bold text-muted-foreground">
                      <span>Publishing listing...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div className="bg-primary h-2 transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    disabled={posting}
                    onClick={() => setStep(2)}
                    className="flex-1 rounded-full py-6 font-bold"
                  >
                    <ChevronLeft className="w-5 h-5 mr-1" />
                    Edit Details
                  </Button>
                  <Button
                    disabled={posting}
                    onClick={handleSubmit}
                    className="flex-1 rounded-full py-6 font-bold bg-primary text-foreground hover:bg-primary/90 text-base"
                  >
                    {posting ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Publishing...
                      </span>
                    ) : (
                      "Publish Listing"
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Desktop Right Column: Live Sticky Card Preview */}
          <div className="hidden md:block md:col-span-5">
            <div className="sticky top-20 p-5 rounded-3xl border border-border bg-card shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Listing Preview</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {listingType}
                </span>
              </div>

              {/* Card Photo Preview */}
              <div className="relative aspect-square rounded-2xl overflow-hidden bg-secondary border border-border">
                {imageFiles.length > 0 ? (
                  <Image
                    src={URL.createObjectURL(imageFiles[coverIndex] || imageFiles[0])}
                    alt="Preview"
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                    <ImageIcon className="w-10 h-10 mb-2 opacity-40" />
                    <span className="text-xs font-medium">No photo uploaded yet</span>
                  </div>
                )}
                {listingType === "Giveaway" && (
                  <div className="absolute top-3 left-3 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">
                    Free / Giveaway
                  </div>
                )}
              </div>

              {/* Card Meta Preview */}
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-bold text-lg text-foreground line-clamp-1 font-sans">
                    {title || "Listing Title"}
                  </h3>
                  <span className="text-lg font-extrabold text-primary font-sans shrink-0">
                    {listingType === "Giveaway" ? "FREE" : price ? `₦${Number(price).toLocaleString()}` : "₦0"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-0.5 rounded-md bg-secondary text-secondary-foreground font-medium">
                    {condition}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-md bg-secondary text-secondary-foreground font-medium">
                    {subCategory || "Category"}
                  </span>
                </div>

                {description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 pt-1">
                    {description}
                  </p>
                )}

                {locationAddress && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1">
                    <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="truncate">{locationAddress}</span>
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
