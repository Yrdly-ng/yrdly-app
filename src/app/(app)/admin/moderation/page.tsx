"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { ModerationAdminService, ModerationQueueItem } from '@/lib/moderation-admin';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, Clock, CheckCircle, XCircle, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function AdminModerationPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [queue, setQueue] = useState<ModerationQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 20;

  const fetchQueue = useCallback(async () => {
    try {
      setLoading(true);
      const { data, count } = await ModerationAdminService.getQueue(statusFilter, page, limit);
      setQueue(data);
      setTotalCount(count);
    } catch (error) {
      console.error('Error fetching moderation queue:', error);
      toast({
        title: "Error",
        description: "Failed to load moderation queue.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page, toast]);

  useEffect(() => {
    if (!user) {
      router.push('/signin');
      return;
    }
    fetchQueue();
  }, [user, statusFilter, page, router, fetchQueue]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const handleAction = async (queueId: string, action: 'approve' | 'reject') => {
    try {
      setActionLoading(queueId);
      await ModerationAdminService.moderateContent(queueId, action);
      
      toast({
        title: "Success",
        description: `Content ${action}d successfully.`,
      });
      
      // Remove from list if we are on 'pending' view, else refresh
      if (statusFilter === 'pending') {
        setQueue(q => q.filter(item => item.id !== queueId));
        setTotalCount(c => Math.max(0, c - 1));
      } else {
        fetchQueue();
      }
      
    } catch (error: any) {
      console.error(`Error ${action}ing content:`, error);
      toast({
        title: "Error",
        description: error.message || `Failed to ${action} content.`,
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'pending': { color: 'bg-yellow-500', text: 'Pending', icon: Clock },
      'approved': { color: 'bg-green-500', text: 'Approved', icon: CheckCircle },
      'rejected': { color: 'bg-red-500', text: 'Rejected', icon: XCircle },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const Icon = config.icon;
    
    return (
      <Badge className={`${config.color} text-foreground`}>
        <Icon className="mr-1 h-3 w-3" />
        {config.text}
      </Badge>
    );
  };

  if (loading && queue.length === 0) {
    return (
      <div className="min-h-[100dvh] bg-background p-4">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Moderation Queue</h1>
            <p className="text-muted-foreground">Review flagged content across Yrdly</p>
          </div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Skeleton className="h-24 w-24 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-12 w-full mt-4" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold">Moderation Queue</h1>
            <p className="text-muted-foreground">Review flagged content across Yrdly</p>
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex gap-4">
            <div className="flex-1" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Queue List */}
        {queue.length === 0 ? (
          <Card>
            <CardContent className="text-center p-8">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Queue Empty</h3>
              <p className="text-muted-foreground">
                There is no flagged content waiting for review.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {queue.map((item) => (
              <Card key={item.id} className="overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-start gap-6">
                    
                    {/* Media preview */}
                    <div className="w-32 flex-shrink-0 flex flex-col gap-2">
                      {item.image_urls && item.image_urls.length > 0 ? (
                        item.image_urls.map((url, idx) => (
                          <div key={idx} className="w-full aspect-square relative rounded-lg overflow-hidden bg-muted border">
                            <Image src={url} alt="Flagged content" fill className="object-cover" />
                          </div>
                        ))
                      ) : (
                        <div className="w-full aspect-square relative rounded-lg overflow-hidden bg-muted border flex items-center justify-center">
                          <ImageIcon className="h-8 w-8 text-muted-foreground opacity-50" />
                        </div>
                      )}
                    </div>

                    {/* Content Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h3 className="font-semibold text-lg flex items-center gap-2">
                            Type: <span className="capitalize">{item.table_name}</span>
                          </h3>
                          <p className="text-sm text-muted-foreground mt-1">
                            Flagged Reason: <span className="text-foreground font-medium">{item.reason}</span>
                          </p>
                        </div>
                        {getStatusBadge(item.status)}
                      </div>

                      {item.text_content && (
                        <div className="mb-4">
                          <p className="text-sm font-medium mb-1">Text Content:</p>
                          <div className="p-3 bg-muted rounded-md text-sm whitespace-pre-wrap">
                            {item.text_content}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-4 text-xs text-muted-foreground mt-4">
                        <div>User ID: {item.user_id}</div>
                        <div>Date: {new Date(item.created_at).toLocaleString()}</div>
                      </div>
                    </div>

                    {/* Actions */}
                    {item.status === 'pending' && (
                      <div className="flex flex-col gap-2 min-w-[120px]">
                        <Button 
                          onClick={() => handleAction(item.id, 'approve')}
                          disabled={actionLoading === item.id}
                          className="bg-green-600 hover:bg-green-700"
                        >
                          Approve
                        </Button>
                        <Button 
                          onClick={() => handleAction(item.id, 'reject')}
                          disabled={actionLoading === item.id}
                          variant="destructive"
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pagination Controls */}
        {totalCount > limit && (
          <div className="flex justify-between items-center mt-6">
            <span className="text-sm text-muted-foreground">
              Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} items
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page * limit >= totalCount} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
