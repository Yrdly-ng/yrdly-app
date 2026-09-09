"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Loader2, Save, Trash2, Tag, MapPin, DollarSign } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';

const CONDITIONS = ['New', 'Like New', 'Good', 'Fair', 'Poor'];

export default function EditMarketplaceItemPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = params.itemId as string;
  const { user } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState(CONDITIONS[0]);
  const [address, setAddress] = useState('');
  const [existingImages, setExistingImages] = useState<string[]>([]);

  const fetchItem = useCallback(async () => {
    if (!itemId || !user) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('id', itemId)
        .single();

      if (error || !data) throw new Error('Listing not found');

      if (data.user_id !== user.id) {
        toast({
          title: "Unauthorized",
          description: "You can only edit your own listings.",
          variant: "destructive",
        });
        router.back();
        return;
      }

      setTitle(data.title || '');
      setText(data.text || '');
      setPrice(data.price?.toString() || '');
      setCategory(data.category || '');
      setCondition(data.condition || CONDITIONS[0]);
      setAddress(data.location?.address || '');

      let imgs: string[] = [];
      if (Array.isArray(data.image_urls)) {
        imgs = data.image_urls;
      } else if (typeof data.image_urls === 'string') {
        try {
          imgs = JSON.parse(data.image_urls);
        } catch (_) {}
      }
      setExistingImages(imgs);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to load listing.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [itemId, user, router, toast]);

  useEffect(() => {
    fetchItem();
  }, [fetchItem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !price) {
      toast({
        title: "Missing Fields",
        description: "Please enter title and price.",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const parsedPrice = parseFloat(price);

      const { error } = await supabase
        .from('posts')
        .update({
          title,
          text,
          price: isNaN(parsedPrice) ? 0 : parsedPrice,
          category,
          condition,
          image_urls: existingImages,
          updated_at: new Date().toISOString(),
        })
        .eq('id', itemId);

      if (error) throw error;

      toast({
        title: "Listing Updated",
        description: "Your listing has been updated successfully.",
      });

      router.push(`/marketplace/${itemId}`);
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to update listing.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const removeImage = (index: number) => {
    setExistingImages(prev => prev.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <div className="container max-w-2xl py-6 space-y-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-6 space-y-6">
      <div className="flex items-center space-x-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Edit Marketplace Listing</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium">Update Item Details</CardTitle>
          <CardDescription>Modify item title, price, description, and images.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="item-title">Title</Label>
              <Input
                id="item-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Item title"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item-price">Price (₦)</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="item-price"
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    className="pl-9"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="item-condition">Condition</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger id="item-condition">
                    <SelectValue placeholder="Select condition" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-category">Category</Label>
              <Input
                id="item-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. Electronics, Fashion, Home"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="item-text">Description</Label>
              <Textarea
                id="item-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Describe your item..."
                rows={4}
              />
            </div>

            {existingImages.length > 0 && (
              <div className="space-y-2">
                <Label>Item Images</Label>
                <div className="flex flex-wrap gap-3">
                  {existingImages.map((url, idx) => (
                    <div key={idx} className="relative h-20 w-20 rounded-md overflow-hidden border">
                      <Image src={url} alt="Item thumbnail" fill className="object-cover" />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-black/60 text-white hover:bg-black/80"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Changes
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
