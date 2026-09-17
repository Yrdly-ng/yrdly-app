"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2, Star, MapPin, Search, Plus, Store, CheckCircle } from 'lucide-react';
import Image from 'next/image';

export interface Business {
  id: string;
  name: string;
  category: string;
  description: string | null;
  logo_url: string | null;
  image_url: string | null;
  rating: number | null;
  review_count: number | null;
  is_verified: boolean | null;
  user_id: string;
  address: string | null;
  created_at: string;
}

export function BusinessHub({ searchQuery = '' }: { searchQuery?: string }) {
  const router = useRouter();
  const { user } = useAuth();

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState(searchQuery);

  const fetchBusinesses = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from('businesses')
        .select('*')
        .order('created_at', { ascending: false });

      const { data, error } = await q;
      if (error) throw error;
      setBusinesses((data as Business[]) || []);
    } catch (e) {
      console.error('Error fetching businesses:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  const categories = Array.from(
    new Set(businesses.map((b) => b.category).filter(Boolean))
  );

  const filteredBusinesses = businesses.filter((b) => {
    const matchesSearch =
      !localSearch ||
      b.name.toLowerCase().includes(localSearch.toLowerCase()) ||
      b.category?.toLowerCase().includes(localSearch.toLowerCase()) ||
      b.description?.toLowerCase().includes(localSearch.toLowerCase());

    const matchesCategory = !activeCategory || b.category === activeCategory;

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search local businesses..."
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Button onClick={() => router.push('/businesses/create')} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Register Business
        </Button>
      </div>

      {categories.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          <Button
            variant={activeCategory === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveCategory(null)}
            className="rounded-full shrink-0"
          >
            All Categories
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
              className="rounded-full shrink-0"
            >
              {cat}
            </Button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="overflow-hidden">
              <Skeleton className="h-40 w-full" />
              <CardHeader className="space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : filteredBusinesses.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent className="space-y-3">
            <Store className="h-12 w-12 text-muted-foreground mx-auto" />
            <h3 className="text-lg font-semibold">No Businesses Found</h3>
            <p className="text-sm text-muted-foreground">
              Try adjusting your search criteria or register a new business.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredBusinesses.map((biz) => {
            const isOwner = user?.id === biz.user_id;

            return (
              <Card
                key={biz.id}
                className="overflow-hidden hover:shadow-md transition-shadow cursor-pointer flex flex-col"
                onClick={() => router.push(`/businesses/${biz.id}`)}
              >
                <div className="relative h-40 bg-muted">
                  {biz.image_url || biz.logo_url ? (
                    <Image
                      src={biz.image_url || biz.logo_url!}
                      alt={biz.name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <Building2 className="h-12 w-12" />
                    </div>
                  )}
                  {biz.is_verified && (
                    <Badge className="absolute top-3 right-3 bg-blue-600 text-white gap-1">
                      <CheckCircle className="h-3 w-3" />
                      Verified
                    </Badge>
                  )}
                </div>

                <CardHeader className="p-4 space-y-1">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-bold line-clamp-1">{biz.name}</CardTitle>
                    {biz.rating ? (
                      <div className="flex items-center space-x-1 text-yellow-500 text-sm font-semibold">
                        <Star className="h-4 w-4 fill-yellow-500" />
                        <span>{biz.rating.toFixed(1)}</span>
                        {biz.review_count ? (
                          <span className="text-muted-foreground text-xs">({biz.review_count})</span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <Badge variant="secondary" className="w-fit text-xs">
                    {biz.category}
                  </Badge>
                </CardHeader>

                <CardContent className="p-4 pt-0 text-sm text-muted-foreground flex-1">
                  <p className="line-clamp-2 mb-2">{biz.description || 'Local business serving the community.'}</p>
                  {biz.address && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-auto">
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{biz.address}</span>
                    </div>
                  )}
                </CardContent>

                {isOwner && (
                  <CardFooter className="p-3 bg-muted/30 border-t flex justify-between items-center text-xs font-medium text-primary">
                    <span>Manage your business</span>
                    <Button variant="ghost" size="sm" className="h-7 text-xs">
                      Edit Business
                    </Button>
                  </CardFooter>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
