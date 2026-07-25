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
import { Switch } from "@/components/ui/switch";
import { X, Image as ImageIcon, Loader2, PlusCircle } from "lucide-react";
import { useState, useEffect, memo, useCallback, useMemo } from "react";
import * as React from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { CatalogItem } from "@/types";
import Image from "next/image";
import { CatalogService } from "@/lib/catalog-service";
import { useToast } from "@/hooks/use-toast";

/* ─── design tokens (shared with CreateItemDialog) ─────────────────── */
const BG_DARK = "var(--c-bg)";

const CATALOG_CATEGORIES = [
  "Electronics",
  "Fashion & Apparel",
  "Food & Beverages",
  "Beauty & Health",
  "Home & Garden",
  "Sports & Fitness",
  "Books & Media",
  "Toys & Games",
  "Automotive",
  "General",
];

const BlobImage = memo(({ file, className, alt }: { file: File; className?: string; alt?: string }) => {
  const [url, setUrl] = useState<string>("");
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

const getFormSchema = (existingImageCount: number) =>
  z.object({
    title: z.string().min(3, "Title must be at least 3 characters.").max(100, "Title too long"),
    description: z.string().min(1, "Description is required.").max(1000, "Description too long"),
    price: z.preprocess(
      (val) => (val === "" || val === null || val === undefined ? undefined : Number(val)),
      z.number().positive("Price must be positive.")
    ),
    category: z.string().min(1, "Category is required."),
    in_stock: z.boolean().default(true),
    image: z
      .any()
      .refine(
        (files) =>
          files &&
          (files.length > 0 ||
            (Array.isArray(files) && files.some((f) => typeof f === "string"))),
        "At least one image is required."
      )
      .refine(
        (files) => {
          const newCount = files && typeof files.length === "number" && !Array.isArray(files) ? files.length : 0;
          return existingImageCount + newCount <= 4;
        },
        "You can add up to 4 images per item."
      ),
  });

type CreateCatalogItemDialogProps = {
  children?: React.ReactNode;
  businessId: string;
  itemToEdit?: CatalogItem;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
};

/* ─── inner form body shared by Dialog & Sheet ───────────────────── */
interface FormBodyProps {
  form: ReturnType<typeof useForm<any>>;
  onSubmit: (values: any) => Promise<void>;
  loading: boolean;
  isEditMode: boolean;
  itemToEdit?: CatalogItem;
  removedImageIndexes: number[];
  setRemovedImageIndexes: React.Dispatch<React.SetStateAction<number[]>>;
  remainingExistingImages: number;
  onClose: () => void;
}

function FormBody({
  form,
  onSubmit,
  loading,
  isEditMode,
  itemToEdit,
  removedImageIndexes,
  setRemovedImageIndexes,
  remainingExistingImages,
  onClose,
}: FormBodyProps) {
  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 text-foreground pb-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-black font-sans">
          {isEditMode ? "Edit Catalog Item" : "Add Catalog Item"}
        </h1>
        <button type="button" onClick={onClose} className="w-11 h-11 rounded-full bg-background/10 flex items-center justify-center hover:bg-background/20 transition">
          <X className="w-5 h-5" />
        </button>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

          <div className="space-y-4 p-6 rounded-3xl bg-card border border-border">
            <h2 className="text-lg font-bold font-sans text-primary">Item Details</h2>

            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground">Item Title</FormLabel>
                <FormControl><Input placeholder="e.g., iPhone 15 Pro" className="bg-background border-border h-12 rounded-xl text-base" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-muted-foreground">Description</FormLabel>
                <FormControl><Textarea placeholder="Describe your item..." className="bg-background border-border rounded-xl resize-none h-24 text-base" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="price" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground">Price (₦)</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">₦</span>
                      <Input type="number" placeholder="0.00" className="bg-background border-border h-12 rounded-xl pl-8 text-base" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="category" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-muted-foreground">Category</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className="flex h-12 w-full rounded-xl border border-border bg-background px-4 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {CATALOG_CATEGORIES.map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="in_stock" render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-xl border border-border bg-background p-4">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">In Stock</FormLabel>
                  <div className="text-sm text-muted-foreground">
                    Mark this item as available for purchase
                  </div>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />

            <FormItem>
              <FormLabel className="text-muted-foreground">Images (Max 4 — shown as a slideshow)</FormLabel>
              <label className="flex items-center gap-3 w-full bg-background border border-border h-12 rounded-xl px-4 cursor-pointer hover:bg-accent transition">
                <ImageIcon className="w-5 h-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {form.watch("image") && form.watch("image").length > 0 ? `${form.watch("image").length} image(s) selected` : "Choose images..."}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (!files || files.length === 0) return;
                    const remainingSlots = Math.max(4 - Math.max(remainingExistingImages, 0), 0);

                    // Keep files already picked in an earlier pass, then add the new ones on top
                    const currentValue = form.getValues("image");
                    const alreadyPicked: File[] = currentValue && typeof currentValue.length === "number"
                      ? Array.from(currentValue as FileList).filter((f) => f instanceof File)
                      : [];

                    const combined = [...alreadyPicked, ...Array.from(files)].slice(0, remainingSlots);
                    const dt = new DataTransfer();
                    combined.forEach((f) => dt.items.add(f));
                    form.setValue("image", dt.files, { shouldValidate: true });

                    // Reset the input so picking the same file again still fires onChange
                    e.target.value = "";
                  }}
                />
              </label>
              <FormMessage />
            </FormItem>

            {/* Newly selected image previews */}
            {form.watch("image") && form.watch("image").length > 0 && Array.from(form.watch("image") as FileList).some(f => f instanceof File) && (
              <div className="space-y-2 mt-4">
                <p className="text-sm text-muted-foreground font-sans">New images:</p>
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {Array.from(form.watch("image") as FileList).filter(f => f instanceof File).map((file, i) => (
                    <div key={i} className="relative w-16 h-16 flex-shrink-0 rounded-md overflow-hidden group">
                      <BlobImage file={file as File} alt="Preview" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => {
                          const currentValue = form.getValues("image");
                          const remaining = Array.from(currentValue as FileList).filter((f) => f instanceof File) as File[];
                          remaining.splice(i, 1);
                          const dt = new DataTransfer();
                          remaining.forEach((f) => dt.items.add(f));
                          form.setValue("image", dt.files, { shouldValidate: true });
                        }}
                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={12} className="text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Existing images (edit mode) */}
            {itemToEdit?.images && itemToEdit.images.length > 0 && (
              <div className="space-y-2 mt-4">
                <p className="text-sm text-muted-foreground font-sans">Current images ({itemToEdit.images.length}):</p>
                <div className="grid grid-cols-4 gap-2">
                  {itemToEdit.images.map((url, index) => {
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

          <button type="submit" className="w-full h-14 rounded-full font-sans font-bold text-lg bg-primary flex items-center justify-center hover:bg-[#2E7D32] transition-colors disabled:opacity-50" disabled={loading}>
            {loading ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> {isEditMode ? "Saving..." : "Adding..."}</> : (isEditMode ? "Save Changes" : "List Item")}
          </button>
        </form>
      </Form>
    </div>
  );
}

/* ─── main component ─────────────────────────────────────────────── */
const CreateCatalogItemDialogComponent = ({
  children,
  businessId,
  itemToEdit,
  onOpenChange,
  onSuccess,
}: CreateCatalogItemDialogProps) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [removedImageIndexes, setRemovedImageIndexes] = useState<number[]>([]);
  const isMobile = useIsMobile();
  const isEditMode = !!itemToEdit;
  const { toast } = useToast();

  const remainingExistingImages = (itemToEdit?.images?.length || 0) - removedImageIndexes.length;
  const formSchema = useMemo(
    () => getFormSchema(Math.max(remainingExistingImages, 0)),
    [remainingExistingImages]
  );

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: "",
      description: "",
      price: "" as any,
      category: "General",
      in_stock: true,
      image: undefined,
    },
  });

  const stableFormReset = useCallback((values: any) => form.reset(values), [form]);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (isEditMode && itemToEdit) {
          stableFormReset({
            title: itemToEdit.title,
            description: itemToEdit.description,
            price: itemToEdit.price,
            category: itemToEdit.category || "General",
            in_stock: itemToEdit.in_stock ?? true,
            image: itemToEdit.images || [],
          });
        } else if (!isEditMode) {
          stableFormReset({
            title: "",
            description: "",
            price: "",
            category: "General",
            in_stock: true,
            image: undefined,
          });
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [open, isEditMode, itemToEdit, stableFormReset]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      setOpen(newOpen);
      onOpenChange?.(newOpen);
      if (!newOpen) {
        form.reset();
        setRemovedImageIndexes([]);
      }
    },
    [onOpenChange, form]
  );

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    try {
      let existingImages: string[] = [];
      if (itemToEdit?.images) {
        existingImages = itemToEdit.images.filter((_, index) => !removedImageIndexes.includes(index));
      }

      let validImageFiles: FileList | undefined;
      if (values.image && values.image.length > 0) {
        const validFiles = Array.from(values.image).filter(
          (f) => f && f instanceof File && (f as File).name && (f as File).size > 0
        );
        if (validFiles.length > 0) {
          const dt = new DataTransfer();
          validFiles.forEach((f) => dt.items.add(f as File));
          validImageFiles = dt.files;
        }
      }

      if (isEditMode && itemToEdit) {
        await CatalogService.updateCatalogItem(
          itemToEdit.id,
          businessId,
          {
            title: values.title,
            description: values.description,
            price: values.price,
            category: values.category,
            in_stock: values.in_stock,
          },
          validImageFiles,
          existingImages
        );
        toast({ title: "Success", description: "Catalog item updated successfully" });
      } else {
        await CatalogService.createCatalogItem(
          businessId,
          {
            title: values.title,
            description: values.description,
            price: values.price,
            category: values.category,
            in_stock: values.in_stock,
          },
          validImageFiles
        );
        toast({ title: "Success", description: "Catalog item created successfully" });
      }

      handleOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error("Error saving catalog item:", error);
      toast({
        title: "Error",
        description: "Failed to save catalog item. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const formBodyProps: FormBodyProps = {
    form,
    onSubmit,
    loading,
    isEditMode,
    itemToEdit,
    removedImageIndexes,
    setRemovedImageIndexes,
    remainingExistingImages,
    onClose: () => handleOpenChange(false),
  };

  const trigger = children ?? (
    <button type="button" className="inline-flex items-center px-4 h-10 rounded-full bg-primary font-sans font-bold text-sm">
      <PlusCircle className="h-5 w-5 mr-2" />
      Add Item
    </button>
  );

  /* ── Mobile: bottom Sheet ── */
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
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
      <DialogTrigger asChild>{trigger}</DialogTrigger>
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

export const CreateCatalogItemDialog = memo(CreateCatalogItemDialogComponent);