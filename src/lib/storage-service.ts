import { supabase } from './supabase';

export class StorageService {
  // Get proper MIME type for file
  private static getMimeType(file: File): string {
    // Validate file parameter
    if (!file || !file.name) {
      console.warn('Invalid file provided to getMimeType:', file);
      return 'image/jpeg'; // Default fallback
    }

    // If file already has a proper MIME type, use it
    if (file.type && file.type !== 'application/octet-stream') {
      return file.type;
    }

    // Handle HEIC files specifically
    if (file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')) {
      return 'image/heic';
    }

    // Handle other common image formats
    const extension = file.name.toLowerCase().split('.').pop();
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'svg':
        return 'image/svg+xml';
      case 'bmp':
        return 'image/bmp';
      case 'tiff':
        return 'image/tiff';
      // Video formats
      case 'mp4':
        return 'video/mp4';
      case 'webm':
        return 'video/webm';
      case 'mov':
        return 'video/quicktime';
      default:
        return 'image/jpeg'; // Default fallback
    }
  }

  // Convert HEIC to JPEG if needed
  private static async convertHeicToJpeg(file: File): Promise<File> {
    // Add null/undefined checks
    if (!file || !file.name) {
      console.warn('Invalid file provided to convertHeicToJpeg:', file);
      return file;
    }

    if (!file.name.toLowerCase().endsWith('.heic') && !file.name.toLowerCase().endsWith('.heif')) {
      return file;
    }

    try {
      // Create a canvas to convert HEIC to JPEG
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      return new Promise((resolve, reject) => {
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx?.drawImage(img, 0, 0);
          
          canvas.toBlob((blob) => {
            if (blob) {
              const newFile = new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), {
                type: 'image/jpeg',
                lastModified: file.lastModified
              });
              resolve(newFile);
            } else {
              reject(new Error('Failed to convert HEIC to JPEG'));
            }
          }, 'image/jpeg', 0.9);
        };

        img.onerror = () => reject(new Error('Failed to load HEIC image'));
        img.src = URL.createObjectURL(file);
      });
    } catch (error) {
      console.error('HEIC conversion error:', error);
      return file; // Return original file if conversion fails
    }
  }

  // Upload a file to Supabase Storage
  static async uploadFile(
    bucket: string,
    path: string,
    file: File,
    options?: {
      cacheControl?: string;
      contentType?: string;
    }
  ): Promise<{ data: any; error: any }> {
    try {
      // Validate file parameter
      if (!file) {
        console.error('No file provided to uploadFile');
        return { data: null, error: new Error('No file provided') };
      }

      // Convert HEIC files to JPEG
      const processedFile = await this.convertHeicToJpeg(file);
      
      // Get proper MIME type
      const mimeType = this.getMimeType(processedFile);
      
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, processedFile, {
          cacheControl: options?.cacheControl || '3600',
          upsert: false,
          contentType: options?.contentType || mimeType,
        });

      if (error) {
        console.error('Storage upload error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Storage upload error:', error);
      return { data: null, error };
    }
  }

  // Get public URL for a file
  static getPublicUrl(bucket: string, path: string): string {
    const { data } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);
    
    return data.publicUrl;
  }

  // Get signed URL for a file (for private files)
  static async getSignedUrl(
    bucket: string,
    path: string,
    expiresIn: number = 3600
  ): Promise<{ data: any; error: any }> {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);

      if (error) {
        console.error('Storage signed URL error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Storage signed URL error:', error);
      return { data: null, error };
    }
  }

  // Delete a file
  static async deleteFile(
    bucket: string,
    path: string
  ): Promise<{ data: any; error: any }> {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .remove([path]);

      if (error) {
        console.error('Storage delete error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Storage delete error:', error);
      return { data: null, error };
    }
  }

  // List files in a bucket
  static async listFiles(
    bucket: string,
    path?: string
  ): Promise<{ data: any; error: any }> {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(path || '');

      if (error) {
        console.error('Storage list error:', error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Storage list error:', error);
      return { data: null, error };
    }
  }

  // Upload post image
  static async uploadPostImage(
    postId: string,
    file: File
  ): Promise<{ url: string | null; error: any }> {
    try {
      const fileName = `${Date.now()}_${file.name}`;
      const path = `posts/${postId}/${fileName}`;

      const { data, error } = await this.uploadFile('post-images', path, file);
      
      if (error) {
        return { url: null, error };
      }

      const publicUrl = this.getPublicUrl('post-images', path);
      return { url: publicUrl, error: null };
    } catch (error) {
      console.error('Upload post image error:', error);
      return { url: null, error };
    }
  }

  // Upload chat image
  static async uploadChatImage(
    conversationId: string,
    file: File
  ): Promise<{ url: string | null; error: any }> {
    try {

      const fileName = `${Date.now()}_${file.name}`;
      const path = `${conversationId}/${fileName}`;

      const { data, error } = await this.uploadFile('chat-images', path, file);
      
      if (error) {
        console.error('❌ Upload file error:', error);
        console.error('❌ Error details:', {
          message: error.message,
          statusCode: error.statusCode,
          error: error.error,
          data: error.data
        });
        
        // Try with a different path structure as fallback
        const fallbackPath = `chat/${conversationId}/${fileName}`;
        
        const { data: fallbackData, error: fallbackError } = await this.uploadFile('chat-images', fallbackPath, file);
        
        if (fallbackError) {
          console.error('❌ Fallback upload also failed:', fallbackError);
          return { url: null, error: fallbackError };
        }
        
        const fallbackUrl = this.getPublicUrl('chat-images', fallbackPath);
        return { url: fallbackUrl, error: null };
      }

      const publicUrl = this.getPublicUrl('chat-images', path);
      return { url: publicUrl, error: null };
    } catch (error) {
      console.error('❌ Upload chat image error:', error);
      return { url: null, error };
    }
  }

  // Upload user avatar
  static async uploadUserAvatar(
    userId: string,
    file: File
  ): Promise<{ url: string | null; error: any }> {
    try {
      const fileName = `${Date.now()}_${file.name}`;
      const path = `avatars/${userId}/${fileName}`;

      const { data, error } = await this.uploadFile('user-avatars', path, file, {
        cacheControl: '3600',
        contentType: this.getMimeType(file),
      });
      
      if (error) {
        // Try with upsert as fallback
        const { data: d2, error: e2 } = await supabase.storage
          .from('user-avatars')
          .upload(path, file, {
            cacheControl: '3600',
            upsert: true,
            contentType: this.getMimeType(file),
          });
        if (e2) return { url: null, error: e2 };
        const publicUrl = this.getPublicUrl('user-avatars', d2?.path || path);
        return { url: publicUrl, error: null };
      }

      const publicUrl = this.getPublicUrl('user-avatars', path);
      return { url: publicUrl, error: null };
    } catch (error) {
      console.error('Upload user avatar error:', error);
      return { url: null, error };
    }
  }

  // Upload dispute evidence
  static async uploadDisputeEvidence(
    transactionId: string,
    file: File
  ): Promise<{ url: string | null; error: any }> {
    try {
      const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
      const path = `${transactionId}/${fileName}`;

      const { data, error } = await this.uploadFile('dispute-evidence', path, file);
      
      if (error) {
        return { url: null, error };
      }

      const publicUrl = this.getPublicUrl('dispute-evidence', path);
      return { url: publicUrl, error: null };
    } catch (error) {
      console.error('Upload dispute evidence error:', error);
      return { url: null, error };
    }
  }

  // Upload post video (Supabase JS v2 uses Tus resumable protocol automatically for files > 6 MB)
  static async uploadPostVideo(
    userId: string,
    file: File
  ): Promise<{ url: string | null; thumbnailDataUrl: string | null; error: any }> {
    try {
      const { validateVideoFile, generateVideoThumbnail } = await import('./video-utils');
      const validationError = validateVideoFile(file);
      if (validationError) {
        return { url: null, thumbnailDataUrl: null, error: validationError };
      }

      const ext = file.name.split('.').pop() ?? 'mp4';
      const path = `${userId}/${Date.now()}.${ext}`;

      const { data, error } = await supabase.storage
        .from('post-videos')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || this.getMimeType(file),
        });

      if (error) {
        console.error('Post video upload error:', error);
        return { url: null, thumbnailDataUrl: null, error };
      }

      const url = this.getPublicUrl('post-videos', data.path);
      const thumbnailDataUrl = await generateVideoThumbnail(file);
      return { url, thumbnailDataUrl, error: null };
    } catch (error) {
      console.error('Post video upload error:', error);
      return { url: null, thumbnailDataUrl: null, error };
    }
  }

  // Upload a video in a DM conversation
  static async uploadChatVideo(
    conversationId: string,
    file: File
  ): Promise<{ url: string | null; error: any }> {
    try {
      const { validateVideoFile } = await import('./video-utils');
      const validationError = validateVideoFile(file);
      if (validationError) {
        return { url: null, error: validationError };
      }

      const ext = file.name.split('.').pop() ?? 'mp4';
      const path = `${conversationId}/${Date.now()}.${ext}`;

      const { data, error } = await supabase.storage
        .from('chat-videos')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
          contentType: file.type || this.getMimeType(file),
        });

      if (error) {
        console.error('Chat video upload error:', error);
        return { url: null, error };
      }

      return { url: this.getPublicUrl('chat-videos', data.path), error: null };
    } catch (error) {
      console.error('Chat video upload error:', error);
      return { url: null, error };
    }
  }
}

