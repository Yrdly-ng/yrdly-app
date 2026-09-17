"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
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
  Trash2,
  MapPin,
  Sparkles,
  Save,
  Globe,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const CONDITIONS = ["New", "Like New", "Good", "Fair", "Poor"];

export default function EditMarketplaceItemPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = params.itemId as string;

  const { user } = useAuth();
  const { toast } = useToast();
  const { deletePost, refreshPosts } = usePosts();
  const { categories, loading: categoriesLoading } = useCategories("marketplace");

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form State
  const [listingType, setListingType] = useState<"For Sale" | "Giveaway">("For Sale");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [condition, setCondition] = useState("Like New");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");

  // Location State
  const [locationAddress, setLocationAddress] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<StructuredLocation | null>(null);

  // Images State
  const [existingImages, setExistingImages] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const fetchItem = useCallback(async () => {
    if (!itemId || !user) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("posts")
        .select("*")
        .eq("id", itemId)
        .single();

      if (error || !data) throw new Error("Listing not found");

      if (data.user_id !== user.id) {
        toast({
          variant: "destructive",
          title: "Unauthorized",
          description: "You can only edit your own listings.",
        });
        router.push("/marketplace");
        return;
      }

      setListingType(data.category === "Giveaway" ? "Giveaway" : "For Sale");
      setTitle(data.title || "");
      setDescription(data.text || "");
      setPrice(data.price?.toString() || "");
      setSubCategory(data.sub_category || data.category || "");
      setCondition(data.condition || "Like New");
      setVisibility(data.visibility?.toLowerCase() === "private" ? "private" : "public");

      // Build location string if available
      const locStr = [data.ward, data.lga, data.state].filter(Boolean).join(", ");
      setLocationAddress(locStr || "");
      if (data.lat && data.lng) {
        setSelectedLocation({
          address: locStr,
          lat: data.lat,
          lng: data.lng,
          ward: data.ward || "",
          lga: data.lga || "",
          state: data.state || "",
        });
      }

      let imgs: string[] = [];
      if (Array.isArray(data.image_urls)) {
        imgs = data.image_urls;
      } else if (typeof data.image_urls === "string") {
        try {
          imgs = JSON.parse(data.image_urls);
        } catch (_) {}
      }
      setExistingImages(imgs);
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: err.message || "Failed to load listing.",
      });
      router.push("/marketplace");
    } finally {
      setLoading(false);
    }
  }, [itemId, user, router, toast]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const selected = Array.from(e.target.files);
    const currentTotal = existingImages.length + newFiles.length;
    const available = 10 - currentTotal;

    if (available <= 0) {
      toast({ variant: "destructive", title: "Limit Reached", description: "Maximum 10 photos allowed." });
      return;
    }

    setNewFiles((prev) => [...prev, ...selected.slice(0, available)]);
  };

  const removeExistingImage = (index: number) => {
    setExistingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeNewFile = (index: number) => {
    setNewFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Submit Update Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({ variant: "destructive", title: "Title Required", description: "Please enter a title." });
      return;
    }

    const totalImages = existingImages.length + newFiles.length;
    if (totalImages === 0) {
      toast({ variant: "destructive", title: "Photo Required", description: "Please keep or add at least one photo." });
      return;
    }

    setSubmitting(true);

    try {
      // 1. Upload new image files
      const newlyUploadedUrls: string[] = [];
      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        const ext = file.name.split(".").pop() || "jpg";
        const path = `${user!.id}/${Date.now()}_${i}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("post-images")
          .upload(path, file, { contentType: file.type || "image/jpeg", cacheControl: "604800", upsert: true });

        if (uploadErr) throw uploadErr;

        const { data: pubData } = supabase.storage.from("post-images").getPublicUrl(path);
        if (pubData?.publicUrl) {
          newlyUploadedUrls.push(pubData.publicUrl);
        }
      }

      const finalImageUrls = [...existingImages, ...newlyUploadedUrls];

      // 2. Moderation check on text
      const textToModerate = [title.trim(), description.trim()].filter(Boolean).join(" ");
      let modStatus: "approved" | "pending" = "approved";
      let modReason = "";

      if (textToModerate) {
        const textMod = await ModerationService.checkText(textToModerate);
        if (!textMod.isSafe) {
          modStatus = "pending";
          modReason = textMod.reason || "Flagged text content";
        }
      }

      // 3. Update DB record (Writing category AND sub_category separately)
      const updatePayload = {
        title: title.trim(),
        text: description.trim(),
        category: listingType === "Giveaway" ? "Giveaway" : "For Sale",
        sub_category: subCategory || (categories[0]?.name || "Other"),
        price: listingType === "Giveaway" ? 0 : parseFloat(price) || 0,
        condition: condition,
        image_urls: finalImageUrls,
        visibility: visibility,
        moderation_status: modStatus,
        state: selectedLocation?.state || null,
        lga: selectedLocation?.lga || null,
        ward: selectedLocation?.ward || null,
        lat: selectedLocation?.lat || null,
        lng: selectedLocation?.lng || null,
      };

      const { error: updateErr } = await supabase
        .from("posts")
        .update(updatePayload)
        .eq("id", itemId);

      if (updateErr) throw updateErr;

      // 4. Insert into moderation_queue if flagged
      if (modStatus === "pending") {
        await supabase.from("moderation_queue").insert({
          content_id: itemId,
          table_name: "posts",
          user_id: user!.id,
          status: "pending",
          reason: modReason,
          text_content: textToModerate,
          image_urls: finalImageUrls,
        });
      }

      toast({
        title: "Listing Updated",
        description: modStatus === "pending" ? "Listing updated and sent for moderation review." : "Listing updated successfully.",
      });

      if (refreshPosts) refreshPosts();
      router.push("/marketplace");
    } catch (err: any) {
      console.error("Update failed:", err);
      toast({
        variant: "destructive",
        title: "Update Error",
        description: err?.message || "Failed to update listing.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Delete Handler reusing usePosts deletePost
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deletePost(itemId);
      toast({ title: "Listing Deleted", description: "Your item has been removed." });
      router.push("/marketplace");
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Delete Error",
        description: err?.message || "Failed to delete listing.",
      });
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-2" />
        <p className="text-sm text-muted-foreground">Loading listing details...</p>
      </div>
    );
  }

  const allPreviewImages = [
    ...existingImages,
    ...newFiles.map((f) => URL.createObjectURL(f)),
  ];

  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Top Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="w-11 h-11 rounded-full hover:bg-secondary shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-bold font-sans text-foreground">Edit Listing</h1>
          </div>

          {/* Delete Action Trigger */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="w-11 h-11 rounded-full text-destructive hover:bg-destructive/10 shrink-0">
                <Trash2 className="w-5 h-5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Listing?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. Your item listing will be permanently removed from the marketplace.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-[44px]"
                >
                  {deleting ? "Deleting..." : "Delete Permanently"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      {/* Main Content Area: Responsive Split on Desktop */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
          {/* Edit Form Column */}
          <form onSubmit={handleSubmit} className="space-y-6 md:col-span-7">
            {/* For Sale vs Giveaway Toggle */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Listing Type</label>
              <div className="flex rounded-full bg-secondary p-1 border border-border">
                <button
                  type="button"
                  onClick={() => setListingType("For Sale")}
                  className={cn(
                    "flex-1 min-h-[44px] py-2.5 rounded-full text-sm font-bold font-sans transition-all flex items-center justify-center",
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
                    "flex-1 min-h-[44px] py-2.5 rounded-full text-sm font-bold font-sans transition-all flex items-center justify-center gap-1.5",
                    listingType === "Giveaway" ? "bg-emerald-500 text-white shadow" : "text-muted-foreground"
                  )}
                >
                  <Sparkles className="w-4 h-4" />
                  Giveaway (Free)
                </button>
              </div>
            </div>

            {/* Photo Management */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Photos ({existingImages.length + newFiles.length}/10)
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {/* Existing Images */}
                {existingImages.map((url, idx) => (
                  <div
                    key={`existing-${idx}`}
                    className="relative aspect-square rounded-2xl overflow-hidden border border-border bg-secondary group"
                  >
                    <Image src={url} alt={`Photo ${idx + 1}`} fill className="object-cover" />
                    {idx === 0 && (
                      <div className="absolute top-2 left-2 bg-primary text-foreground text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                        Cover
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeExistingImage(idx)}
                      className="absolute top-2 right-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                      aria-label="Remove image"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                {/* New Image Files */}
                {newFiles.map((file, idx) => (
                  <div
                    key={`new-${idx}`}
                    className="relative aspect-square rounded-2xl overflow-hidden border border-primary/50 bg-secondary group"
                  >
                    <Image src={URL.createObjectURL(file)} alt={`New ${idx + 1}`} fill className="object-cover" />
                    {existingImages.length === 0 && idx === 0 && (
                      <div className="absolute top-2 left-2 bg-primary text-foreground text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                        Cover
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeNewFile(idx)}
                      className="absolute top-2 right-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                      aria-label="Remove image"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                {/* Add Photo Trigger */}
                {existingImages.length + newFiles.length < 10 && (
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
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageSelect}
              />
            </div>

            {/* Title */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Title *</label>
              <Input
                placeholder="Item title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                className="rounded-xl min-h-[44px]"
              />
            </div>

            {/* Price (Disabled/Hidden when Giveaway) */}
            {listingType === "For Sale" && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Price (₦) *</label>
                <Input
                  type="number"
                  placeholder="Price"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="rounded-xl min-h-[44px]"
                />
              </div>
            )}

            {/* Sub Category Selector */}
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
                        "min-h-[44px] inline-flex items-center justify-center px-4 py-2.5 rounded-full text-xs font-semibold border transition-all",
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
                      "min-h-[44px] inline-flex items-center justify-center px-4 py-2.5 rounded-full text-xs font-semibold border transition-all",
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

            {/* Description */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Description</label>
              <Textarea
                placeholder="Description of item..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={5}
                className="rounded-xl resize-none"
              />
            </div>

            {/* Location Search Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Location</label>
              <LocationInput
                value={locationAddress}
                onChange={setLocationAddress}
                onLocationSelect={(loc) => {
                  setSelectedLocation(loc);
                  setLocationAddress(loc.address);
                }}
                placeholder="Search LGA, Ward or area in Nigeria..."
              />
            </div>

            {/* Audience Visibility */}
            <div className="p-4 rounded-2xl bg-secondary/50 border border-border space-y-3">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Audience Visibility</label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setVisibility("public")}
                  className={cn(
                    "flex-1 min-h-[44px] p-3 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all justify-center",
                    visibility === "public" ? "bg-primary text-foreground border-primary" : "bg-background border-border text-muted-foreground"
                  )}
                >
                  <Globe className="w-4 h-4 text-primary" />
                  <span>Public</span>
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility("private")}
                  className={cn(
                    "flex-1 min-h-[44px] p-3 rounded-xl border flex items-center gap-2 text-xs font-bold transition-all justify-center",
                    visibility === "private" ? "bg-primary text-foreground border-primary" : "bg-background border-border text-muted-foreground"
                  )}
                >
                  <Users className="w-4 h-4 text-amber-500" />
                  <span>Friends Only</span>
                </button>
              </div>
            </div>

            {/* Submit Actions */}
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={submitting}
                className="flex-1 min-h-[44px] rounded-full py-3.5 font-bold bg-primary text-foreground hover:bg-primary/90 text-base"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Save className="w-4 h-4" /> Save Changes
                  </span>
                )}
              </Button>
            </div>
          </form>

          {/* Desktop Live Card Preview */}
          <div className="hidden md:block md:col-span-5">
            <div className="sticky top-20 p-5 rounded-3xl border border-border bg-card shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Listing Preview</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {listingType}
                </span>
              </div>

              {/* Card Photo */}
              <div className="relative aspect-square rounded-2xl overflow-hidden bg-secondary border border-border">
                {allPreviewImages.length > 0 ? (
                  <Image src={allPreviewImages[0]} alt="Preview" fill className="object-cover" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground p-4 text-center">
                    <ImageIcon className="w-10 h-10 mb-2 opacity-40" />
                    <span className="text-xs font-medium">No photo</span>
                  </div>
                )}
                {listingType === "Giveaway" && (
                  <div className="absolute top-3 left-3 bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow">
                    Free / Giveaway
                  </div>
                )}
              </div>

              {/* Card Details */}
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-bold text-lg text-foreground line-clamp-1 font-sans">{title || "Title"}</h3>
                  <span className="text-lg font-extrabold text-primary font-sans shrink-0">
                    {listingType === "Giveaway" ? "FREE" : price ? `₦${Number(price).toLocaleString()}` : "₦0"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2.5 py-0.5 rounded-md bg-secondary text-secondary-foreground font-medium">{condition}</span>
                  <span className="px-2.5 py-0.5 rounded-md bg-secondary text-secondary-foreground font-medium">{subCategory || "Category"}</span>
                </div>

                {description && <p className="text-xs text-muted-foreground line-clamp-2 pt-1">{description}</p>}

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
