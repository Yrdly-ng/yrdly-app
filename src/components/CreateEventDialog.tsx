
"use client";

import { useForm, UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
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
import { PlusCircle, X, Ticket } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useState, useEffect, memo, useCallback, useMemo } from "react";
import * as React from 'react';
import { LocationInput, LocationValue } from "./LocationInput";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePosts } from "@/hooks/use-posts";
import type { Post } from "@/types";
import Image from "next/image";
import { cn } from "@/lib/utils";

const inputBase = "bg-background border border-[#388E3C] text-foreground placeholder:text-muted-foreground placeholder:italic font-sans text-xs focus-visible:ring-[#388E3C] focus-visible:ring-offset-0";
const labelClass = "font-sans font-semibold text-xs text-foreground";
const pointerClass = "w-2 h-2 border-b border-l border-[#388E3C] rounded-bl-md flex-shrink-0 mt-1.5";

const BlobImage = memo(({ file, className }: { file: File, className?: string }) => {
  const [url, setUrl] = useState<string>('');
  
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

const getFormSchema = (isEditMode: boolean, postToEdit?: Post) => z.object({
  title: z.string().min(1, "Event title can't be empty.").max(100),
  description: z.string().min(1, "Event description can't be empty.").max(1000),
  location: z.custom<LocationValue>().refine(value => value && value.address.length > 0, {
    message: "Location is required.",
  }),
  eventDateTime: z.string().min(1, "Date and time are required."),
  eventLink: z.union([z.string().url("Please enter a valid URL."), z.literal("")]).optional(),
  image: z.any().refine((files) => {
    if (isEditMode && postToEdit?.image_urls?.length) return true;
    return files && ((typeof FileList !== "undefined" && files instanceof FileList && files.length > 0) || (Array.isArray(files) && files.some(f => typeof f === "string")));
  }, "An image is required for the event."),
});

type CreateEventDialogProps = {
    children?: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
    postToEdit?: Post;
    open?: boolean; // Add open prop for programmatic control
}

const CreateEventDialogComponent = memo(function CreateEventDialog({ children, onOpenChange, postToEdit, open: externalOpen }: CreateEventDialogProps) {
  const { createPost } = usePosts();
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removedImageIndexes, setRemovedImageIndexes] = useState<number[]>([]);
  const isMobile = useIsMobile();
  const isEditMode = !!postToEdit;
  
  // Use external open prop if provided, otherwise use internal state
  const open = externalOpen !== undefined ? externalOpen : internalOpen;

  // Create form schema once and stabilize it
  const formSchema = useMemo(() => getFormSchema(isEditMode, postToEdit), [isEditMode, postToEdit]);

  // Create form once and stabilize it - don't recreate on every render
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      location: { address: "" },
      eventDateTime: "",
      eventLink: "",
      image: undefined,
    },
  });

  // Stabilize form.reset function to prevent dependency issues
  const stableFormReset = useCallback((values: any) => {
    form.reset(values);
  }, [form]);

  // Fix useEffect dependencies - only reset when dialog opens, not on every change
  useEffect(() => {
    if (open) {
      // Use setTimeout to ensure this runs after the dialog is fully opened
      const timer = setTimeout(() => {
        if (isEditMode && postToEdit) {
          // Combine date and time for datetime-local input
          const eventDateTime = postToEdit.event_date && postToEdit.event_time 
            ? `${postToEdit.event_date}T${postToEdit.event_time}`
            : '';
          
          stableFormReset({
            title: postToEdit.title,
            description: postToEdit.text || postToEdit.description || "",
            location: postToEdit.event_location,
            eventDateTime: eventDateTime,
            eventLink: postToEdit.event_link,
            image: postToEdit.image_urls || [],
          });
        } else if (!isEditMode) {
          stableFormReset({
            title: "",
            description: "",
            location: { address: "" },
            eventDateTime: "",
            eventLink: "",
            image: undefined,
          });
        }
      }, 0);
      
      return () => clearTimeout(timer);
    }
  }, [open, isEditMode, postToEdit, stableFormReset]); // Include all dependencies

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    
    // Filter out removed images
    let filteredImageUrls: string[] = [];
    if (postToEdit?.image_urls) {
      filteredImageUrls = postToEdit.image_urls.filter((_, index) => !removedImageIndexes.includes(index));
    }
    
    // Validate image files
    let validImageFiles: FileList | undefined;
    if (values.image && values.image.length > 0) {
      // Filter out invalid files
      const validFiles = Array.from(values.image).filter(file => 
        file && file instanceof File && file.name && file.size > 0
      );
      
      if (validFiles.length > 0) {
        // Create a new FileList-like object
        const dataTransfer = new DataTransfer();
        validFiles.forEach(file => dataTransfer.items.add(file as File));
        validImageFiles = dataTransfer.files;
      }
    }
    
    // Parse datetime-local input to separate date and time
    const eventDateTime = new Date(values.eventDateTime);
    const eventDate = eventDateTime.toISOString().split('T')[0];
    const eventTime = eventDateTime.toTimeString().split(' ')[0].substring(0, 5);
    
    const eventData: Partial<Post> = {
        category: "Event",
        text: values.description,
        title: values.title,
        event_location: values.location,
        event_date: eventDate,
        event_time: eventTime,
        event_link: values.eventLink || undefined,
        attendees: postToEdit?.attendees || [],
        image_urls: filteredImageUrls,
    };
    await createPost(eventData, postToEdit?.id, validImageFiles);
    setLoading(false);
    handleOpenChange(false);
  }

  const handleOpenChange = useCallback((newOpenState: boolean) => {
    if (externalOpen !== undefined) {
      // External control - only call onOpenChange
      if (onOpenChange) {
        onOpenChange(newOpenState);
      }
    } else {
      // Internal control - update internal state
      setInternalOpen(newOpenState);
      if (onOpenChange) {
        onOpenChange(newOpenState);
      }
    }
    
    if (!newOpenState) {
      form.reset();
      setRemovedImageIndexes([]);
    }
  }, [onOpenChange, externalOpen, form]);

  const finalTitle = isEditMode ? "Edit Event" : "Create Event";
  const finalDescription = isEditMode ? "Make changes to your event." : "Plan and share your neighborhood event.";

  type FormValues = z.infer<typeof formSchema>;



  const Trigger = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => {
    const { profile: userDetails } = useAuth();
    return (
        <div ref={ref} {...props} className="flex items-center gap-4 w-full">
            <Avatar>
                <AvatarImage src={userDetails?.avatar_url || 'https://placehold.co/100x100.png'}/>
                <AvatarFallback>{userDetails?.name?.charAt(0) || "U"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 text-left text-muted-foreground cursor-pointer hover:bg-muted p-2 rounded-md border border-dashed">
                Organize an event in your neighborhood?
            </div>
             <Button variant="ghost" size="icon"><PlusCircle className="h-6 w-6 text-primary" /></Button>
        </div>
    );
  });
  Trigger.displayName = "Trigger";

  const headerBlock = (
    <div className="flex items-start justify-between gap-4 p-5 sm:p-6 pb-2 flex-shrink-0">
      <div>
        <h2 className="text-lg font-normal text-muted-foreground" style={{ fontFamily: '"Pacifico", cursive' }}>
          {finalTitle}
        </h2>
        <p className="font-sans font-light italic text-xs text-foreground mt-0.5">{finalDescription}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(118.99deg, #FF0048 17.37%, #7D00D0 85.3%)" }}>
          <Ticket className="w-5 h-5 text-foreground" />
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
              name="title"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Event Title</FormLabel>
                  </div>
                  <FormControl>
                    <Input placeholder="e.g Neighborhood Block Party" className={cn(inputBase, "rounded-full h-10")} {...field} />
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
                    <Textarea placeholder="Tell everyone about your event" className={cn(inputBase, "rounded-xl resize-none min-h-[100px]")} {...field} />
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
                    <div className={cn("[&_input]:bg-background [&_input]:border-[#388E3C] [&_input]:rounded-full [&_input]:text-foreground [&_input]:placeholder:text-muted-foreground [&_input]:h-10")}>
                      <LocationInput name={field.name} control={form.control} defaultValue={field.value} />
                    </div>
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="eventDateTime"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Date & Time</FormLabel>
                  </div>
                  <FormControl>
                    <Input type="datetime-local" min={new Date().toISOString().slice(0, 16)} className={cn(inputBase, "rounded-full h-10")} {...field} />
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs" />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="eventLink"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex items-start gap-2">
                    <div className={pointerClass} />
                    <FormLabel className={labelClass}>Event Link</FormLabel>
                  </div>
                  <FormControl>
                    <Input placeholder="Link to tickets or more info" className={cn(inputBase, "rounded-full h-10")} {...field} />
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
                    <FormLabel className={labelClass}>Event Image</FormLabel>
                  </div>
                  <FormControl>
                    <label className={cn("flex items-center gap-2 rounded-[5px] border border-[#388E3C] bg-background px-4 py-3 cursor-pointer text-foreground font-sans text-xs font-semibold italic")}>
                      <span>Choose Files</span>
                      <span className="font-normal text-muted-foreground">
                        {value && value.length > 0 ? `${value.length} file(s)` : "No file chosen"}
                      </span>
                      <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => onChange(e.target.files ?? undefined)} {...rest} />
                    </label>
                  </FormControl>
                  {(value && value.length > 0) || (postToEdit?.image_urls && postToEdit.image_urls.filter((_, i) => !removedImageIndexes.includes(i)).length > 0) ? (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {postToEdit?.image_urls?.map((url, index) => {
                        if (removedImageIndexes.includes(index)) return null;
                        return (
                          <div key={`url-${index}`} className="relative w-14 h-14 rounded overflow-hidden bg-background flex-shrink-0">
                            <Image src={url} alt="" width={56} height={56} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              className="absolute top-0 right-0 w-5 h-5 rounded-full flex items-center justify-center bg-[#FF383C] border border-white"
                              onClick={() => setRemovedImageIndexes((prev) => [...prev, index])}
                            >
                              <X className="w-3 h-3 text-foreground" />
                            </button>
                          </div>
                        );
                      })}
                      {value && Array.from(value).map((file, index) => (
                        <div key={`file-${index}`} className="relative w-14 h-14 rounded overflow-hidden bg-background flex-shrink-0">
                          <BlobImage file={file as File} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            className="absolute top-0 right-0 w-5 h-5 rounded-full flex items-center justify-center bg-[#FF383C] border border-white"
                            onClick={() => {
                              const dt = new DataTransfer();
                              Array.from(value).forEach((f, i) => { if (i !== index) dt.items.add(f as File); });
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
            style={{ background: "#388E3C" }}
            disabled={loading}
          >
            {loading ? (isEditMode ? "Saving..." : "Creating...") : (isEditMode ? "Save Changes" : "Create Event")}
          </Button>
        </div>
      </form>
    </Form>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>{children ? children : <Trigger />}</SheetTrigger>
        <SheetContent side="bottom" className="p-0 flex flex-col max-h-[92dvh] rounded-t-[32px] border border-border bg-card text-foreground overflow-hidden" style={{ zIndex: 110 }} hideClose>
          {headerBlock}
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
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
      <DialogContent className={cn("sm:max-w-[626px] p-0 flex flex-col max-h-[90dvh] border border-border rounded-[24px] bg-card text-foreground gap-0 overflow-hidden")} style={{ zIndex: 110 }} hideClose>
        {headerBlock}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          {formContent}
        </div>
      </DialogContent>
    </Dialog>
  );
});
CreateEventDialogComponent.displayName = "CreateEventDialogComponent";

export const CreateEventDialog = CreateEventDialogComponent;

