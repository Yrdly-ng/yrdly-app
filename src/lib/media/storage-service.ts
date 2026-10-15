import { supabase } from "../supabase/supabase";
import { brandedSupabaseUrl } from "../supabase/supabase-url";
import {
  PRIVATE_MEDIA_BUCKETS,
  privateMediaReference,
  type PrivateMediaBucket,
} from "./private-media";

export class StorageService {
  // Get proper MIME type for file
  private static getMimeType(file: File): string {
    // Validate file parameter
    if (!file || !file.name) {
      console.warn("Invalid file provided to getMimeType:", file);
      return "image/jpeg"; // Default fallback
    }

    // If file already has a proper MIME type, use it
    if (file.type && file.type !== "application/octet-stream") {
      return file.type;
    }

    // Handle HEIC files specifically
    if (
      file.name.toLowerCase().endsWith(".heic") ||
      file.name.toLowerCase().endsWith(".heif")
    ) {
      return "image/heic";
    }

    // Handle other common image formats
    const extension = file.name.toLowerCase().split(".").pop();
    switch (extension) {
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "png":
        return "image/png";
      case "gif":
        return "image/gif";
      case "webp":
        return "image/webp";
      case "svg":
        return "image/svg+xml";
      case "bmp":
        return "image/bmp";
      case "tiff":
        return "image/tiff";
      // Video formats
      case "mp4":
        return "video/mp4";
      case "webm":
        return "video/webm";
      case "mov":
        return "video/quicktime";
      default:
        return "image/jpeg"; // Default fallback
    }
  }

  // Convert HEIC to JPEG if needed
  private static async convertHeicToJpeg(file: File): Promise<File> {
    // Add null/undefined checks
    if (!file || !file.name) {
      console.warn("Invalid file provided to convertHeicToJpeg:", file);
      return file;
    }

    if (
      !file.name.toLowerCase().endsWith(".heic") &&
      !file.name.toLowerCase().endsWith(".heif")
    ) {
      return file;
    }

    try {
      // Create a canvas to convert HEIC to JPEG
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const img = new Image();

      return new Promise((resolve, reject) => {
        img.onload = () => {
          const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(img.src);

          canvas.toBlob(
            (blob) => {
              if (blob) {
                const newFile = new File(
                  [blob],
                  file.name.replace(/\.(heic|heif)$/i, ".jpg"),
                  {
                    type: "image/jpeg",
                    lastModified: file.lastModified,
                  },
                );
                resolve(newFile);
              } else {
                reject(new Error("Failed to convert HEIC to JPEG"));
              }
            },
            "image/jpeg",
            0.9,
          );
        };

        img.onerror = () => {
          URL.revokeObjectURL(img.src);
          reject(new Error("Failed to load HEIC image"));
        };
        img.src = URL.createObjectURL(file);
      });
    } catch (error) {
      console.error("HEIC conversion error:", error);
      return file; // Return original file if conversion fails
    }
  }

  private static async resizeLargeImage(file: File): Promise<File> {
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      typeof createImageBitmap === "undefined"
    )
      return file;
    const image = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
      if (scale === 1) return file; // Edited files are already bounded; do not encode twice.
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare this image");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value
              ? resolve(value)
              : reject(new Error("Could not prepare this image")),
          file.type,
          0.9,
        ),
      );
      return new File([blob], file.name, {
        type: file.type,
        lastModified: file.lastModified,
      });
    } finally {
      image.close();
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
      onProgress?: (fraction: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<{ data: any; error: any }> {
    try {
      // Validate file parameter
      if (!file) {
        console.error("No file provided to uploadFile");
        return { data: null, error: new Error("No file provided") };
      }

      // Convert HEIC files to JPEG
      const processedFile = await this.resizeLargeImage(
        await this.convertHeicToJpeg(file),
      );

      // Get proper MIME type
      const mimeType = this.getMimeType(processedFile);
      const contentType =
        processedFile.type !== file.type
          ? mimeType
          : options?.contentType || mimeType;

      if (options?.onProgress || options?.signal) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Sign in to upload media");
        const url =
          brandedSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!) +
          `/storage/v1/object/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
        return await new Promise<{ data: unknown; error: Error | null }>(
          (resolve) => {
            const xhr = new XMLHttpRequest();
            const cancel = () => xhr.abort();
            const complete = (data: unknown, error: Error | null) => {
              options.signal?.removeEventListener("abort", cancel);
              resolve({ data, error });
            };
            xhr.open("POST", url);
            xhr.timeout = 15 * 60 * 1000;
            xhr.setRequestHeader(
              "Authorization",
              `Bearer ${session.access_token}`,
            );
            xhr.setRequestHeader(
              "apikey",
              process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            );
            xhr.setRequestHeader("Content-Type", contentType);
            xhr.setRequestHeader("x-upsert", "false");
            xhr.setRequestHeader(
              "cache-control",
              options.cacheControl || "3600",
            );
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable)
                options.onProgress?.(Math.min(1, event.loaded / event.total));
            };
            xhr.onerror = () =>
              complete(null, new Error("Upload could not reach the server"));
            xhr.ontimeout = () =>
              complete(
                null,
                new Error("Upload timed out. Your original file is safe."),
              );
            xhr.onabort = () => complete(null, new Error("Upload cancelled"));
            xhr.onload = () => {
              if (xhr.status < 200 || xhr.status >= 300) {
                complete(null, new Error(`Upload rejected (${xhr.status})`));
                return;
              }
              complete({ path }, null);
            };
            options.signal?.addEventListener("abort", cancel, { once: true });
            if (options.signal?.aborted) {
              complete(null, new Error("Upload cancelled"));
              return;
            }
            xhr.send(processedFile);
          },
        );
      }
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, processedFile, {
          cacheControl: options?.cacheControl || "3600",
          upsert: false,
          contentType,
        });

      if (error) {
        console.error("Storage upload error:", error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error("Storage upload error:", error);
      return { data: null, error };
    }
  }

  // Enable durable object references only after shared clients support them.
  // Historical project URLs are also re-authorized by the web signer after privacy flips.
  static getPublicUrl(bucket: string, path: string): string {
    if (
      process.env.NEXT_PUBLIC_PRIVATE_MEDIA_REFERENCES === "true" &&
      PRIVATE_MEDIA_BUCKETS.includes(bucket as PrivateMediaBucket)
    ) {
      return privateMediaReference(bucket as PrivateMediaBucket, path);
    }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);

    return data.publicUrl;
  }

  // Get signed URL for a file (for private files)
  static async getSignedUrl(
    bucket: string,
    path: string,
    expiresIn: number = 3600,
  ): Promise<{ data: any; error: any }> {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);

      if (error) {
        console.error("Storage signed URL error:", error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error("Storage signed URL error:", error);
      return { data: null, error };
    }
  }

  // Delete a file
  static async deleteFile(
    bucket: string,
    path: string,
  ): Promise<{ data: any; error: any }> {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .remove([path]);

      if (error) {
        console.error("Storage delete error:", error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error("Storage delete error:", error);
      return { data: null, error };
    }
  }

  // List files in a bucket
  static async listFiles(
    bucket: string,
    path?: string,
  ): Promise<{ data: any; error: any }> {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .list(path || "");

      if (error) {
        console.error("Storage list error:", error);
        return { data: null, error };
      }

      return { data, error: null };
    } catch (error) {
      console.error("Storage list error:", error);
      return { data: null, error };
    }
  }

  // Upload post image
  static async uploadPostImage(
    postId: string,
    file: File,
  ): Promise<{ url: string | null; error: any }> {
    try {
      // Sanitize: replace spaces and special chars to avoid Supabase storage 400 errors
      const safeName = file.name
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "");
      const fileName = `${Date.now()}_${safeName}`;
      const path = `posts/${postId}/${fileName}`;

      const { data, error } = await this.uploadFile("post-images", path, file, {
        cacheControl: "604800",
      });

      if (error) {
        return { url: null, error };
      }

      const publicUrl = this.getPublicUrl("post-images", path);
      return { url: publicUrl, error: null };
    } catch (error) {
      console.error("Upload post image error:", error);
      return { url: null, error };
    }
  }

  // Upload a comment sticker (photo turned into a small sticker attached to a comment)
  static async uploadCommentSticker(
    postId: string,
    file: File,
  ): Promise<{ url: string | null; error: any }> {
    try {
      const safeName = file.name
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "");
      const fileName = `${Date.now()}_${safeName}`;
      const path = `${postId}/${fileName}`;

      const { data, error } = await this.uploadFile(
        "comment-stickers",
        path,
        file,
        {
          cacheControl: "604800",
        },
      );

      if (error) {
        return { url: null, error };
      }

      const publicUrl = this.getPublicUrl("comment-stickers", path);
      return { url: publicUrl, error: null };
    } catch (error) {
      console.error("Upload comment sticker error:", error);
      return { url: null, error };
    }
  }

  // Upload chat image
  static async uploadChatImage(
    conversationId: string,
    file: File,
  ): Promise<{ url: string | null; error: any }> {
    try {
      const safeName = file.name
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "");
      const fileName = `${Date.now()}_${safeName}`;
      const path = `${conversationId}/${fileName}`;

      const { data, error } = await this.uploadFile("chat-images", path, file, {
        cacheControl: "60",
      });

      if (error) {
        console.error("❌ Upload file error:", error);
        console.error("❌ Error details:", {
          message: error.message,
          statusCode: error.statusCode,
          error: error.error,
          data: error.data,
        });

        // Try with a different path structure as fallback
        const fallbackPath = `chat/${conversationId}/${fileName}`;

        const { data: fallbackData, error: fallbackError } =
          await this.uploadFile("chat-images", fallbackPath, file, {
            cacheControl: "60",
          });

        if (fallbackError) {
          console.error("❌ Fallback upload also failed:", fallbackError);
          return { url: null, error: fallbackError };
        }

        const fallbackUrl = this.getPublicUrl("chat-images", fallbackPath);
        return { url: fallbackUrl, error: null };
      }

      const publicUrl = this.getPublicUrl("chat-images", path);
      return { url: publicUrl, error: null };
    } catch (error) {
      console.error("❌ Upload chat image error:", error);
      return { url: null, error };
    }
  }

  // Upload user avatar
  static async uploadUserAvatar(
    userId: string,
    file: File,
  ): Promise<{ url: string | null; error: any }> {
    try {
      const fileName = `${Date.now()}_${file.name}`;
      const path = `avatars/${userId}/${fileName}`;

      const { data, error } = await this.uploadFile(
        "user-avatars",
        path,
        file,
        {
          cacheControl: "3600",
          contentType: this.getMimeType(file),
        },
      );

      if (error) {
        // Try with upsert as fallback
        const { data: d2, error: e2 } = await supabase.storage
          .from("user-avatars")
          .upload(path, file, {
            cacheControl: "3600",
            upsert: true,
            contentType: this.getMimeType(file),
          });
        if (e2) return { url: null, error: e2 };
        const publicUrl = this.getPublicUrl("user-avatars", d2?.path || path);
        return { url: publicUrl, error: null };
      }

      const publicUrl = this.getPublicUrl("user-avatars", path);
      return { url: publicUrl, error: null };
    } catch (error) {
      console.error("Upload user avatar error:", error);
      return { url: null, error };
    }
  }

  // Upload dispute evidence
  static async uploadDisputeEvidence(
    transactionId: string,
    userId: string,
    file: File,
  ): Promise<{ path: string | null; error: any }> {
    try {
      const safeName = file.name
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "");
      const path = `${transactionId}/${userId}/${Date.now()}_${safeName}`;

      const { data, error } = await this.uploadFile(
        "dispute-evidence",
        path,
        file,
        {
          cacheControl: "3600",
        },
      );
      if (error || !data)
        return {
          path: null,
          error: error || new Error("Upload returned no object"),
        };
      return { path: data.path || path, error: null };
    } catch (error) {
      console.error("Upload dispute evidence error:", error);
      return { path: null, error };
    }
  }

  // Upload post video as binary data; resumable uploads require an explicit Tus client.
  static async uploadPostVideo(
    userId: string,
    file: File,
  ): Promise<{
    url: string | null;
    thumbnailDataUrl: string | null;
    error: any;
  }> {
    try {
      const { validateVideoFile, generateVideoThumbnail } =
        await import("./video-utils");
      const validationError = validateVideoFile(file);
      if (validationError) {
        return { url: null, thumbnailDataUrl: null, error: validationError };
      }

      const ext = file.name.split(".").pop() ?? "mp4";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;

      const { data, error } = await supabase.storage
        .from("post-videos")
        .upload(path, file, {
          cacheControl: "604800",
          upsert: false,
          contentType: file.type || this.getMimeType(file),
        });

      if (error) {
        console.error("Post video upload error:", error);
        return { url: null, thumbnailDataUrl: null, error };
      }

      const url = this.getPublicUrl("post-videos", data.path);
      const thumbnailDataUrl = await generateVideoThumbnail(file);
      return { url, thumbnailDataUrl, error: null };
    } catch (error) {
      console.error("Post video upload error:", error);
      return { url: null, thumbnailDataUrl: null, error };
    }
  }

  // Upload a video in a DM conversation
  static async uploadChatVideo(
    conversationId: string,
    file: File,
  ): Promise<{ url: string | null; error: any }> {
    try {
      const { validateVideoFile } = await import("./video-utils");
      const validationError = validateVideoFile(file);
      if (validationError) {
        return { url: null, error: validationError };
      }

      const ext = file.name.split(".").pop() ?? "mp4";
      const path = `${conversationId}/${crypto.randomUUID()}.${ext}`;

      const { data, error } = await supabase.storage
        .from("chat-videos")
        .upload(path, file, {
          cacheControl: "60",
          upsert: false,
          contentType: file.type || this.getMimeType(file),
        });

      if (error) {
        console.error("Chat video upload error:", error);
        return { url: null, error };
      }

      return { url: this.getPublicUrl("chat-videos", data.path), error: null };
    } catch (error) {
      console.error("Chat video upload error:", error);
      return { url: null, error };
    }
  }

  // Upload a report image
  static async uploadReportImage(
    userId: string,
    file: File,
  ): Promise<{ url: string | null; error: any }> {
    try {
      if (!file || !file.name) {
        return {
          url: null,
          error: new Error("Choose a report image to upload."),
        };
      }
      const maxBytes = 5 * 1024 * 1024;
      const extension = file.name.split(".").pop()?.toLowerCase() || "";
      const expectedTypeByExtension: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
      };
      const isHeic = extension === "heic" || extension === "heif";
      const expectedType = expectedTypeByExtension[extension];
      const typeMatches = isHeic
        ? !file.type || file.type === "image/heic" || file.type === "image/heif"
        : !!expectedType && (!file.type || file.type === expectedType);
      if (file.size > maxBytes || !typeMatches) {
        return {
          url: null,
          error: new Error(
            "Report images must be JPEG, PNG, or WebP and no larger than 5 MB.",
          ),
        };
      }
      const fileExt = file.name.split(".").pop() || "jpg";
      const filePath = `${userId}/${Date.now()}.${fileExt}`;
      const { data, error } = await this.uploadFile("reports", filePath, file, {
        cacheControl: "60",
      });
      if (error) return { url: null, error };
      return { url: this.getPublicUrl("reports", data.path), error: null };
    } catch (error) {
      console.error("Report image upload error:", error);
      return { url: null, error };
    }
  }
}
