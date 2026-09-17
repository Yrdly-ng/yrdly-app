import { supabase } from './supabase';
import type { CatalogItem } from '@/types';


export class CatalogService {
  /**
   * Create a new catalog item for a business
   */
  static async createCatalogItem(
    businessId: string,
    itemData: {
      title: string;
      description: string;
      price: number;
      category?: string;
      in_stock?: boolean;
      quantity?: number;
    },
    imageFiles?: FileList
  ): Promise<string> {
    return await (async () => {
        try {
          // Verify business ownership
          const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select('owner_id')
            .eq('id', businessId)
            .single();

          if (businessError) throw businessError;

          const { data: { user } } = await supabase.auth.getUser();
          if (!user || business.owner_id !== user.id) {
            throw new Error('Unauthorized: You do not own this business');
          }

          // Upload images if provided
          let imageUrls: string[] = [];
          if (imageFiles && imageFiles.length > 0) {
            imageUrls = await this.uploadImages(businessId, imageFiles);
          }

          // Insert catalog item
          const { data, error } = await supabase
            .from('catalog_items')
            .insert({
              business_id: businessId,
              title: itemData.title,
              description: itemData.description,
              price: itemData.price,
              category: itemData.category || 'General',
              images: imageUrls,
              in_stock: (itemData.quantity !== undefined ? itemData.quantity > 0 : true) && (itemData.in_stock ?? true),
              quantity: itemData.quantity ?? 1,
            })
            .select('id')
            .single();

          if (error) throw error;



          return data.id;
        } catch (error) {

          console.error('Error creating catalog item:', error);
          throw new Error('Failed to create catalog item');
        }
      }
    )();
  }

  /**
   * Update an existing catalog item
   */
  static async updateCatalogItem(
    itemId: string,
    businessId: string,
    itemData: Partial<{
      title: string;
      description: string;
      price: number;
      category: string;
      in_stock: boolean;
      quantity: number;
    }>,
    newImageFiles?: FileList,
    existingImages?: string[]
  ): Promise<void> {
    return await (async () => {
        try {
          // Verify business ownership
          const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select('owner_id')
            .eq('id', businessId)
            .single();

          if (businessError) throw businessError;

          const { data: { user } } = await supabase.auth.getUser();
          if (!user || business.owner_id !== user.id) {
            throw new Error('Unauthorized: You do not own this business');
          }

          // Upload new images if provided
          let newImageUrls: string[] = [];
          if (newImageFiles && newImageFiles.length > 0) {
            newImageUrls = await this.uploadImages(businessId, newImageFiles);
          }

          // Combine existing and new images
          const allImages = [...(existingImages || []), ...newImageUrls];

          // Update catalog item
          const updateData: any = { ...itemData };
          if (newImageFiles || existingImages) {
            updateData.images = allImages;
          }
          updateData.updated_at = new Date().toISOString();

          const { error } = await supabase
            .from('catalog_items')
            .update(updateData)
            .eq('id', itemId)
            .eq('business_id', businessId);

          if (error) throw error;


        } catch (error) {

          console.error('Error updating catalog item:', error);
          throw new Error('Failed to update catalog item');
        }
      }
    )();
  }

  /**
   * Delete a catalog item
   */
  static async deleteCatalogItem(itemId: string, businessId: string): Promise<void> {
    return await (async () => {
        try {
          // Verify business ownership
          const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select('owner_id')
            .eq('id', businessId)
            .single();

          if (businessError) throw businessError;

          const { data: { user } } = await supabase.auth.getUser();
          if (!user || business.owner_id !== user.id) {
            throw new Error('Unauthorized: You do not own this business');
          }

          // Get item images to delete from storage
          const { data: item } = await supabase
            .from('catalog_items')
            .select('images')
            .eq('id', itemId)
            .eq('business_id', businessId)
            .single();

          // Delete catalog item
          const { error } = await supabase
            .from('catalog_items')
            .delete()
            .eq('id', itemId)
            .eq('business_id', businessId);

          if (error) throw error;

          // Delete images from storage
          if (item?.images && item.images.length > 0) {
            await this.deleteImages(item.images);
          }


        } catch (error) {

          console.error('Error deleting catalog item:', error);
          throw new Error('Failed to delete catalog item');
        }
      }
    )();
  }

  /**
   * Toggle stock status of a catalog item
   */
  static async toggleStockStatus(itemId: string, businessId: string, inStock: boolean): Promise<void> {
    return await (async () => {
        try {
          // Verify business ownership
          const { data: business, error: businessError } = await supabase
            .from('businesses')
            .select('owner_id')
            .eq('id', businessId)
            .single();

          if (businessError) throw businessError;

          const { data: { user } } = await supabase.auth.getUser();
          if (!user || business.owner_id !== user.id) {
            throw new Error('Unauthorized: You do not own this business');
          }

          // Update stock status
          const { error } = await supabase
            .from('catalog_items')
            .update({
              in_stock: inStock,
              updated_at: new Date().toISOString(),
            })
            .eq('id', itemId)
            .eq('business_id', businessId);

          if (error) throw error;


        } catch (error) {

          console.error('Error toggling stock status:', error);
          throw new Error('Failed to update stock status');
        }
      }
    )();
  }

  /**
   * Get all catalog items for a business
   */
  static async getCatalogItemsByBusiness(businessId: string): Promise<CatalogItem[]> {
    try {
      const { data, error } = await supabase
        .from('catalog_items')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data as CatalogItem[];
    } catch (error) {

      console.error('Error fetching catalog items:', error);
      throw new Error('Failed to fetch catalog items');
    }
  }

  /**
   * Upload images to Supabase storage
   */
  private static async uploadImages(businessId: string, imageFiles: FileList): Promise<string[]> {
    const imageUrls: string[] = [];

    for (let i = 0; i < imageFiles.length; i++) {
      const file = imageFiles[i];
      const fileExt = file.name.split('.').pop();
      const fileName = `${businessId}/${Date.now()}-${i}.${fileExt}`;

      const { data, error } = await supabase.storage
        .from('catalog-items')
        .upload(fileName, file, {
          cacheControl: '86400',
          upsert: false,
        });

      if (error) {
        console.error('Error uploading image:', error);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('catalog-items')
        .getPublicUrl(data.path);

      imageUrls.push(publicUrl);
    }

    return imageUrls;
  }

  /**
   * Delete images from Supabase storage
   */
  private static async deleteImages(imageUrls: string[]): Promise<void> {
    try {
      const filePaths = imageUrls.map(url => {
        const urlParts = url.split('/catalog-items/');
        return urlParts[1];
      }).filter(Boolean);

      if (filePaths.length > 0) {
        await supabase.storage
          .from('catalog-items')
          .remove(filePaths);
      }
    } catch (error) {
      console.error('Error deleting images:', error);
      // Don't throw error, as item is already deleted
    }
  }
}

