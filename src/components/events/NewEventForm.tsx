"use client";

import { useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2, Plus, Trash2, ArrowLeft, Image as ImageIcon, X } from "lucide-react";
import Image from "next/image";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useToast } from "@/hooks/use-toast";
import { StorageService } from "@/lib/storage-service";
import { LocationInput } from "@/components/LocationInput";

const formSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  category: z.string().default("General"),
  location: z.any(),
  eventDateTime: z.string().min(1, "Date & Time is required"),
  ticketTiers: z.array(z.object({
    name: z.string().min(1, "Tier name is required"),
    price: z.number().min(0, "Price must be 0 or more"),
    capacity: z.number().optional(),
  })).min(1, "At least one ticket tier is required"),
});

export function NewEventForm() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [imageFiles, setImageFiles] = useState<File[]>([]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      category: "General",
      location: { address: "" },
      eventDateTime: "",
      ticketTiers: [{ name: "Regular", price: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "ticketTiers",
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!user) return;
    setLoading(true);

    try {
      // Upload all images in parallel; first becomes the cover
      const uploadedUrls: string[] = [];
      if (imageFiles.length > 0) {
        const prefix = "evt_" + Date.now();
        const uploads = await Promise.all(
          imageFiles.map((file, i) =>
            StorageService.uploadPostImage(`${prefix}_${i}`, file)
          )
        );
        for (const { url, error } of uploads) {
          if (error) throw error;
          if (url) uploadedUrls.push(url);
        }
      }
      const coverImageUrl = uploadedUrls[0] || "";

      const eventDateTime = new Date(values.eventDateTime);

      // We call the API Route
      const { supabase } = await import("@/lib/supabase");
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch("/api/events/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          title: values.title,
          description: values.description,
          category: values.category,
          coverImageUrl,
          imageUrls: uploadedUrls,
          locationAddress: values.location?.address || "",
          lat: values.location?.geopoint?.latitude,
          lng: values.location?.geopoint?.longitude,
          state: values.location?.state,
          lga: values.location?.lga,
          ward: values.location?.ward,
          startTime: eventDateTime.toISOString(),
          publish: true,
          ticketTiers: values.ticketTiers,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          throw new Error("You must link a Payout Account in Settings before creating paid tickets.");
        }
        throw new Error(data.error || "Failed to create event");
      }

      toast({ title: "Event created successfully!" });
      router.push(`/events/${data.eventId}`);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 text-foreground pb-24">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => router.back()} className="w-10 h-10 rounded-full bg-background/10 flex items-center justify-center hover:bg-background/20 transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-black font-sans">Create Ticketing Event</h1>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          
          <div className="space-y-4 p-6 rounded-3xl bg-card border border-border">
            <h2 className="text-lg font-bold font-sans text-primary">Event Details</h2>
            
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground">Event Title</FormLabel>
                <FormControl><Input className="bg-background border-border h-12 rounded-xl" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground">Description</FormLabel>
                <FormControl><Textarea className="bg-background border-border rounded-xl resize-none h-24" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="eventDateTime" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground">Date & Time</FormLabel>
                <FormControl><Input type="datetime-local" className="bg-background border-border h-12 rounded-xl" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="location" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground">Location</FormLabel>
                <FormControl>
                  <div className="[&_input]:bg-background [&_input]:border-border [&_input]:h-12 [&_input]:rounded-xl">
                    <LocationInput name={field.name} control={form.control} defaultValue={field.value} />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormItem>
              <FormLabel className="text-muted-foreground">Event Images</FormLabel>
              <label className="flex items-center gap-3 w-full bg-background border border-border h-12 rounded-xl px-4 cursor-pointer hover:bg-accent transition">
                <ImageIcon className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {imageFiles.length > 0 ? `${imageFiles.length} image${imageFiles.length > 1 ? "s" : ""} selected` : "Choose images..."}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (!e.target.files) return;
                    const incoming = Array.from(e.target.files);
                    setImageFiles((prev) => {
                      const combined = [...prev, ...incoming];
                      // deduplicate by name+size
                      const seen = new Set<string>();
                      return combined.filter((f) => {
                        const key = `${f.name}-${f.size}`;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                      });
                    });
                    // reset input so the same file can be re-added after removal
                    e.target.value = "";
                  }}
                />
              </label>

              {/* Image previews */}
              {imageFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted-foreground">First image is the cover.</p>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {imageFiles.map((file, i) => (
                      <div key={`${file.name}-${i}`} className="relative flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border border-border group">
                        <Image
                          src={URL.createObjectURL(file)}
                          alt={`Preview ${i + 1}`}
                          fill
                          className="object-cover"
                          sizes="80px"
                        />
                        {i === 0 && (
                          <div className="absolute bottom-0 inset-x-0 bg-primary/80 text-foreground text-[0.5625rem] font-sans font-bold text-center py-0.5">
                            Cover
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setImageFiles((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3 text-foreground" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </FormItem>
          </div>

          <div className="space-y-4 p-6 rounded-3xl bg-card border border-border">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold font-sans text-primary">Ticket Tiers</h2>
              <Button type="button" variant="outline" size="sm" onClick={() => append({ name: "", price: 0 })} className="rounded-full border-primary text-primary hover:bg-primary/10">
                <Plus className="w-4 h-4 mr-1" /> Add Tier
              </Button>
            </div>
            
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="flex flex-col sm:flex-row gap-3 p-4 rounded-xl bg-background border border-border relative group">
                  <FormField control={form.control} name={`ticketTiers.${index}.name`} render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel className="text-xs text-muted-foreground">Tier Name (e.g. VIP)</FormLabel>
                      <FormControl><Input className="bg-card border-none" {...field} /></FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`ticketTiers.${index}.price`} render={({ field }) => (
                    <FormItem className="w-full sm:w-24">
                      <FormLabel className="text-xs text-muted-foreground">Price (₦)</FormLabel>
                      <FormControl>
                        <Input type="number" min="0" placeholder="0" className="bg-card border-none" {...field} value={field.value === 0 ? "" : field.value} onChange={e => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
                      </FormControl>
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`ticketTiers.${index}.capacity`} render={({ field }) => (
                    <FormItem className="w-full sm:w-24">
                      <FormLabel className="text-xs text-muted-foreground">Qty Limit</FormLabel>
                      <FormControl>
                        <Input type="number" min="1" placeholder="∞" className="bg-card border-none" {...field} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : undefined)} />
                      </FormControl>
                    </FormItem>
                  )} />
                  {fields.length > 1 && (
                    <button type="button" onClick={() => remove(index)} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground italic">Set price to 0 for Free tickets. Leave Qty Limit blank for unlimited tickets.</p>
          </div>

          <Button type="submit" className="w-full h-14 rounded-full font-sans font-bold text-lg bg-primary hover:bg-[#2E7D32] transition-colors" disabled={loading}>
            {loading ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Creating Event...</> : "Publish Event"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
