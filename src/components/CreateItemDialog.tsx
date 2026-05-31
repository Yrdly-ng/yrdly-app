
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
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Image as ImageIcon, Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-supabase-auth";
import { useState, useEffect, memo, useCallback, useMemo } from "react";
import * as React from "react";
import { usePosts } from "@/hooks/use-posts";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Post } from "@/types";
import Image from "next/image";

/* ─── design tokens ─────────────────────────────────────────────── */
const BG_DARK = "var(--c-bg)";
const CARD_BG = "var(--c-card)";
const GREEN = "#388E3C";
const FONT_RALEWAY = "\"Pacifico\", cursive";
const FONT_PACIFICO = "Pacifico, cursive";

/* ─── schema ────────────────────────────────────────────────────── */
const BlobImage = memo(({ file, className, alt }: { file: File, className?: string, alt?: string }) => {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt || ""} className={className} />;
});
BlobImage.displayName = "BlobImage";

const getFormSchema = (isEditMode: boolean) =>
  z.object({
    text: z.string().min(1, "Item title can't be empty.").max(100),
    description: z
      .string()
      .min(1, "Item description is required.")
      .max(1000),
    price: z.preprocess(
      (val) =>
        val === "" || val === null || val === undefined
          ? undefined
          : Number(val),
      z.number().positive("Price must be positive.").optional()
    ),
    image: z
      .any()
      .refine(
        (files) =>
          files &&
          (files.length > 0 ||
            (Array.isArray(files) && files.some((f) => typeof f === "string"))),
        "An image is required for the item."
      ),
  });

type CreateItemDialogProps = {
  children?: React.ReactNode;
  postToEdit?: Post;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

/* ─── inner form body shared by Dialog & Sheet ───────────────────── */
interface FormBodyProps {
  form: ReturnType<typeof useForm<any>>;
  onSubmit: (values: any) => Promise<void>;
  loading: boolean;
  isEditMode: boolean;
  postToEdit?: Post;
  removedImageIndexes: number[];
  setRemovedImageIndexes: React.Dispatch<React.SetStateAction<number[]>>;
  imageField: ReturnType<ReturnType<typeof useForm>["register"]>;
  onClose: () => void;
}

function FormBody({
  form,
  onSubmit,
  loading,
  isEditMode,
  postToEdit,
  removedImageIndexes,
  setRemovedImageIndexes,
  imageField,
  onClose,
}: FormBodyProps) {
  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 text-foreground pb-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-black font-sans">
            {isEditMode ? "Edit Item" : "Create Item for Sale"}
        </h1>
        <button type="button" onClick={onClose} className="w-11 h-11 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition">
          <X className="w-5 h-5" />
        </button>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          
          <div className="space-y-4 p-6 rounded-3xl bg-card border border-border">
            <h2 className="text-lg font-bold font-sans text-[#388E3C]">Item Details</h2>
            
            <FormField control={form.control} name="text" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground">Item Title</FormLabel>
                <FormControl><Input placeholder="e.g Slightly used armchair" className="bg-background border-border h-12 rounded-xl text-base" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground">Description</FormLabel>
                <FormControl><Textarea placeholder="Add more details about the item..." className="bg-background border-border rounded-xl resize-none h-24 text-base" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="price" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground">Price (Optional)</FormLabel>
                <FormControl>
                    <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">₦</span>
                        <Input type="number" placeholder="Leave blank if free" className="bg-background border-border h-12 rounded-xl pl-8 text-base" {...field} />
                    </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormItem>
              <FormLabel className="text-muted-foreground">Item Images</FormLabel>
              <label className="flex items-center gap-3 w-full bg-background border border-border h-12 rounded-xl px-4 cursor-pointer hover:bg-accent transition">
                <ImageIcon className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                    {form.watch("image") && form.watch("image").length > 0 ? `${form.watch("image").length} image(s) selected` : "Choose images..."}
                </span>
                <input type="file" accept="image/*" multiple className="hidden" {...imageField} />
              </label>
              <FormMessage />
            </FormItem>

            {/* Newly selected image previews */}
            {form.watch("image") && form.watch("image").length > 0 && Array.from(form.watch("image") as FileList).some(f => f instanceof File) && (
              <div className="space-y-2 mt-4">
                <p className="text-sm text-muted-foreground font-sans">New images:</p>
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {Array.from(form.watch("image") as FileList).filter(f => f instanceof File).map((file, i) => (
                    <div key={i} className="relative w-16 h-16 flex-shrink-0 rounded-md overflow-hidden">
                      <BlobImage file={file as File} alt="Preview" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Existing images (edit mode) */}
            {postToEdit?.image_urls && postToEdit.image_urls.length > 0 && (
              <div className="space-y-2 mt-4">
                <p className="text-sm text-muted-foreground font-sans">Current images ({postToEdit.image_urls.length}):</p>
                <div className="grid grid-cols-4 gap-2">
                  {postToEdit.image_urls.map((url, index) => {
                    const isRemoved = removedImageIndexes.includes(index);
                    return (
                      <div key={index} className={`relative group rounded-lg overflow-hidden ${isRemoved ? "opacity-40" : ""}`}>
                        <Image src={url} alt={`Image ${index + 1}`} width={80} height={64} className="w-full h-16 object-cover" />
                        {!isRemoved && (
                          <button type="button" onClick={() => setRemovedImageIndexes((p) => [...p, index])} className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <X className="w-3 h-3 text-foreground" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button type="submit" className="w-full h-14 rounded-full font-sans font-bold text-lg bg-[#388E3C] flex items-center justify-center hover:bg-[#2E7D32] transition-colors disabled:opacity-50" disabled={loading}>
            {loading ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {isEditMode ? "Saving..." : "Listing Item..."}</> : (isEditMode ? "Save Changes" : "List Item")}
          </button>
        </form>
      </Form>
    </div>
  );
}

/* ─── main component ─────────────────────────────────────────────── */
const CreateItemDialogComponent = ({
  children,
  postToEdit,
  onOpenChange,
  open: externalOpen,
}: CreateItemDialogProps) => {
  const { createPost } = usePosts();
  const [internalOpen, setInternalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removedImageIndexes, setRemovedImageIndexes] = useState<number[]>([]);
  const isMobile = useIsMobile();
  const isEditMode = !!postToEdit;

  const open = externalOpen !== undefined ? externalOpen : internalOpen;

  const formSchema = useMemo(() => getFormSchema(isEditMode), [isEditMode]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      text: "",
      description: "",
      price: "" as any,
      image: undefined,
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
            text: postToEdit.text,
            description: postToEdit.description,
            price: postToEdit.price,
            image: postToEdit.image_urls || [],
          });
        } else if (!isEditMode) {
          stableFormReset({ text: "", description: "", price: "", image: undefined });
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
    const postData: Partial<Post> = {
      text: values.text,
      description: values.description,
      category: "For Sale",
      price: values.price || 0,
      image_urls: filteredImageUrls,
    };
    await createPost(postData, postToEdit?.id, validImageFiles);
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

  const imageField = form.register("image");

  const formBodyProps: FormBodyProps = {
    form,
    onSubmit,
    loading,
    isEditMode,
    postToEdit,
    removedImageIndexes,
    setRemovedImageIndexes,
    imageField,
    onClose: () => handleOpenChange(false),
  };

  /* ── Mobile: bottom Sheet ── */
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>{children ?? <span />}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="p-0 border-0 rounded-t-2xl overflow-y-auto max-h-[92dvh]"
          style={{ background: BG_DARK, zIndex: 110, paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
          hideClose
        >
          <FormBody {...formBodyProps} />
        </SheetContent>
      </Sheet>
    );
  }

  /* ── Desktop: centered Dialog ── */
  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {externalOpen === undefined && (
        <DialogTrigger asChild>{children ?? <span />}</DialogTrigger>
      )}
      <DialogContent
        className="p-0 border-0 shadow-2xl sm:max-w-[672px] max-h-[90dvh] overflow-y-auto"
        style={{ background: BG_DARK, zIndex: 110 }}
        hideClose
      >
        <FormBody {...formBodyProps} />
      </DialogContent>
    </Dialog>
  );
};

export const CreateItemDialog = memo(CreateItemDialogComponent);
