'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronDown, ChevronUp, Image as ImageIcon, X, Loader2, Check } from 'lucide-react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase';
import { StorageService } from '@/lib/storage-service';
import { useToast } from '@/hooks/use-toast';

const REPORT_CATEGORIES = [
  'Technical Bug',
  'Marketplace Dispute',
  'Inappropriate Content / Behaviour',
  'Account & Security',
  'Other',
];

export default function ReportIssuePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  const removeImage = () => {
    setImageFile(null);
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!subject.trim() || !description.trim()) {
      toast({
        title: 'Error',
        description: 'Please fill in both the subject and description.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      let uploadedImageUrl: string | null = null;
      if (imageFile && user) {
        const { url, error: uploadError } = await StorageService.uploadReportImage(user.id, imageFile);
        if (uploadError) {
          console.warn('Failed to upload image', uploadError);
        } else {
          uploadedImageUrl = url;
        }
      }

      // 1. Try to insert into reports table
      const insertData: Record<string, any> = {
        user_id: user?.id || null,
        category,
        subject: subject.trim(),
        description: description.trim(),
        status: 'open',
      };

      if (uploadedImageUrl) {
        insertData.image_url = uploadedImageUrl;
      }

      const { error } = await supabase.from('reports').insert(insertData);

      if (error) {
        console.warn('DB report insert failed, falling back to email client:', error);

        let bodyText = description;
        if (uploadedImageUrl) {
          bodyText += `\n\nAttached Image: ${uploadedImageUrl}`;
        }

        const safeSubject = encodeURIComponent(`[Report - ${category || 'General'}] ${subject}`);
        const safeBody = encodeURIComponent(bodyText);

        const mailUrl = `mailto:support@yrdly.ng?subject=${safeSubject}&body=${safeBody}`;
        window.location.href = mailUrl;

        toast({
          title: 'Opening Email Client',
          description: 'We opened your email app to send the report. Please send the pre-filled email.',
        });
        router.back();
      } else {
        toast({
          title: 'Thank You',
          description: 'Your report has been submitted successfully. Our team will review it shortly.',
        });
        router.back();
      }
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err?.message || 'Failed to submit report.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedCategoryLabel = category || 'Select Category';

  return (
    <div className="min-h-screen bg-background text-foreground pb-12">
      {/* Top Header */}
      <header className="sticky top-0 z-20 backdrop-blur-md bg-background/80 border-b border-border/50 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-xl bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="font-bold text-lg text-foreground">Report an Issue</h1>
        <div className="w-9" />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6">
        <p className="text-xs sm:text-sm text-muted-foreground mb-6 leading-relaxed">
          If you run into technical bugs, have marketplace disputes, or wish to report inappropriate
          content or behaviour, let us know below.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Category Dropdown */}
          <div>
            <label className="block text-[11px] font-bold tracking-wider text-muted-foreground uppercase mb-2">
              Issue Category
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowDropdown(!showDropdown)}
                className="w-full h-12 px-4 rounded-xl bg-card border border-border/60 flex items-center justify-between text-sm text-foreground hover:bg-muted/30 transition-colors"
              >
                <span>{selectedCategoryLabel}</span>
                {showDropdown ? (
                  <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
              </button>

              {showDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-card border border-border/60 rounded-xl shadow-lg overflow-hidden py-1 max-h-56 overflow-y-auto">
                  {REPORT_CATEGORIES.map((catName: string) => (
                    <button
                      key={catName}
                      type="button"
                      onClick={() => {
                        setCategory(catName);
                        setShowDropdown(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm flex items-center justify-between hover:bg-muted/50 transition-colors"
                    >
                      <span className={category === catName ? 'font-semibold text-primary' : 'text-foreground'}>
                        {catName}
                      </span>
                      {category === catName && <Check className="w-4 h-4 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-[11px] font-bold tracking-wider text-muted-foreground uppercase mb-2">
              Subject
            </label>
            <input
              type="text"
              placeholder="e.g. Can't link bank account"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full h-12 px-4 rounded-xl bg-card border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-bold tracking-wider text-muted-foreground uppercase mb-2">
              Description
            </label>
            <textarea
              placeholder="Describe the issue in detail..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              className="w-full p-4 rounded-xl bg-card border border-border/60 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
            />
          </div>

          {/* Attachment */}
          <div>
            <label className="block text-[11px] font-bold tracking-wider text-muted-foreground uppercase mb-2">
              Attachment (Optional)
            </label>
            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
            />

            {imagePreview ? (
              <div className="relative w-full h-40 rounded-xl overflow-hidden border border-border/60 group">
                <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={removeImage}
                  className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-24 rounded-xl border border-dashed border-border/70 bg-card hover:bg-muted/30 flex flex-col items-center justify-center text-muted-foreground transition-colors"
              >
                <ImageIcon className="w-6 h-6 mb-1 text-muted-foreground" />
                <span className="text-xs">Click to select an image</span>
              </button>
            )}
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-full bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity flex items-center justify-center disabled:opacity-50 mt-6"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit Report'}
          </button>
        </form>
      </main>
    </div>
  );
}
