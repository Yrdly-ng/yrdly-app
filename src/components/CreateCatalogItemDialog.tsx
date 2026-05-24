"use client";

import { useForm } from "react-hook-form";
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
import { Switch } from "@/components/ui/switch";
import { PlusCircle, X } from "lucide-react";
import { useState, useEffect, memo, useCallback, useMemo } from "react";
import * as React from 'react';
import { useIsMobile } from "@/hooks/use-mobile";
import type { CatalogItem } from "@/types";
import Image from "next/image";
import { CatalogService } from "@/lib/catalog-service";
import { useToast } from "@/hooks/use-toast";

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

const getFormSchema = (isEditMode: boolean) => z.object({
  title: z.string().min(3, "Title must be at least 3 characters.").max(100, "Title too long"),
  description: z.string().min(1, "Description is required.").max(1000, "Description too long"),
  price: z.preprocess(
    (val) => (val === "" || val === null || val === undefined ? undefined : Number(val)),
    z.number().positive("Price must be positive.")
  ),
  category: z.string().min(1, "Category is required."),
  in_stock: z.boolean().default(true),
  image: z.any().refine(
    (files) => files && (files.length > 0 || (Array.isArray(files) && files.some(f => typeof f === 'string'))),
    "At least one image is required."
  ),
});

type CreateCatalogItemDialogProps = {
  children?: React.ReactNode;
  businessId: string;
  itemToEdit?: CatalogItem;
  onOpenChange?: (open: boolean) => void;
  onSuccess?: () => void;
}

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

  const formSchema = useMemo(() => getFormSchema(isEditMode), [isEditMode]);

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

  const stableFormReset = useCallback((values: any) => {
    form.reset(values);
  }, [form]);

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
            price: "" as any,
            category: "General",
            in_stock: true,
            image: undefined,
          });
        }
      }, 0);
      
      return () => clearTimeout(timer);
    }
  }, [open, isEditMode, itemToEdit, stableFormReset]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    
    try {
      // Filter out removed images
      let existingImages: string[] = [];
      if (itemToEdit?.images) {
        existingImages = itemToEdit.images.filter((_, index) => !removedImageIndexes.includes(index));
      }
      
      // Validate image files
      let validImageFiles: FileList | undefined;
      if (values.image && values.image.length > 0) {
        const validFiles = Array.from(values.image).filter(file => 
          file && file instanceof File && file.name && file.size > 0
        );
        
        if (validFiles.length > 0) {
          const dataTransfer = new DataTransfer();
          validFiles.forEach(file => dataTransfer.items.add(file as File));
          validImageFiles = dataTransfer.files;
        }
      }

      if (isEditMode && itemToEdit) {
        // Update existing item
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
        
        toast({
          title: "Success",
          description: "Catalog item updated successfully",
        });
      } else {
        // Create new item
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
        
        toast({
          title: "Success",
          description: "Catalog item created successfully",
        });
      }

      handleOpenChange(false);
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Error saving catalog item:', error);
      toast({
        title: "Error",
        description: "Failed to save catalog item. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const handleOpenChange = useCallback((newOpenState: boolean) => {
    setOpen(newOpenState);
    if (onOpenChange) {
      onOpenChange(newOpenState);
    }
    
    if (!newOpenState) {
      form.reset();
      setRemovedImageIndexes([]);
    }
  }, [onOpenChange, form]);

  const finalTitle = isEditMode ? "Edit Catalog Item" : "Add Catalog Item";
  const finalDescription = isEditMode ? "Update your catalog item details." : "Add a new item to your business catalog.";

  const FormContent = (
    <div className="space-y-4 px-1 pb-4">
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Item Title</FormLabel>
            <FormControl>
              <Input placeholder="e.g., iPhone 15 Pro" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      
      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea placeholder="Describe your item..." {...field} rows={4} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="price"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Price (₦)</FormLabel>
              <FormControl>
                <Input 
                  type="number" 
                  placeholder="0.00" 
                  {...field} 
                  onChange={(e) => field.onChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {CATALOG_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="in_stock"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <FormLabel className="text-base">In Stock</FormLabel>
              <div className="text-sm text-muted-foreground">
                Mark this item as available for purchase
              </div>
            </div>
            <FormControl>
              <Switch
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            </FormControl>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="image"
        render={({ field: { onChange, value, ...rest } }) => (
          <FormItem>
            <FormLabel>
              Images <span className="text-destructive">*</span> (Max 10)
            </FormLabel>
            <FormControl>
              <Input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => onChange(e.target.files)}
                {...rest}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {itemToEdit?.images && itemToEdit.images.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            Current images ({itemToEdit.images.length}):
          </div>
          <div className="grid grid-cols-3 gap-2">
            {itemToEdit.images.map((url, index) => {
              const isRemoved = removedImageIndexes.includes(index);
              return (
                <div key={index} className={`relative group ${isRemoved ? 'opacity-50' : ''}`}>
                  <Image
                    src={url}
                    alt={`Current image ${index + 1}`}
                    width={100}
                    height={100}
                    className="w-full h-20 object-cover rounded-lg"
                  />
                  {!isRemoved && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute -top-2 -right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => {
                        setRemovedImageIndexes(prev => [...prev, index]);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                  {isRemoved && (
                    <div className="absolute inset-0 bg-red-500/20 rounded-lg flex items-center justify-center">
                      <X className="h-6 w-6 text-red-500" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground">
            Upload more images to add to the list.
          </div>
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger asChild>
          {children || (
            <Button>
              <PlusCircle className="h-5 w-5 mr-2" />
              Add Item
            </Button>
          )}
        </SheetTrigger>
        <SheetContent side="bottom" className="p-0 flex flex-col h-[90vh] max-h-[100dvh]">
          <SheetHeader className="p-4 border-b flex-shrink-0">
            <SheetTitle>{finalTitle}</SheetTitle>
            <DialogDescription>{finalDescription}</DialogDescription>
          </SheetHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 overflow-y-auto p-4">
                {FormContent}
              </div>
              <SheetFooter className="p-4 border-t flex-shrink-0">
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (isEditMode ? 'Saving...' : 'Adding...') : (isEditMode ? 'Save Changes' : 'Add Item')}
                </Button>
              </SheetFooter>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children || (
          <Button>
            <PlusCircle className="h-5 w-5 mr-2" />
            Add Item
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] lg:max-w-[700px] p-0 flex flex-col max-h-[90vh]">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col h-full">
            <DialogHeader className="p-6 pb-0 flex-shrink-0">
              <DialogTitle>{finalTitle}</DialogTitle>
              <DialogDescription>{finalDescription}</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-6 min-h-0">
              {FormContent}
            </div>
            <DialogFooter className="p-6 pt-0 border-t flex-shrink-0">
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (isEditMode ? 'Saving...' : 'Adding...') : (isEditMode ? 'Save Changes' : 'Add Item')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export const CreateCatalogItemDialog = memo(CreateCatalogItemDialogComponent);

