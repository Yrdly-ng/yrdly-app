"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowLeft, Clock, Mail, Phone, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

interface DeletionRequest {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  delete_requested_at: string | null;
}

export default function AdminDeletionRequestsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('users')
        .select('id, name, email, phone, avatar_url, created_at, delete_requested_at')
        .eq('delete_requested', true)
        .order('delete_requested_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (e: any) {
      console.error(e);
      toast({
        title: "Error",
        description: "Failed to load deletion requests queue.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleMarkResolved = async (requestId: string) => {
    setResolvingId(requestId);
    try {
      const { error } = await supabase
        .from('users')
        .update({ delete_requested: false })
        .eq('id', requestId);

      if (error) throw error;

      setRequests(prev => prev.filter(r => r.id !== requestId));
      toast({
        title: "Request Resolved",
        description: "The deletion request flag has been cleared.",
      });
    } catch (e: any) {
      toast({
        title: "Error",
        description: e.message || "Failed to resolve request.",
        variant: "destructive",
      });
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <div className="container max-w-4xl py-6 space-y-6">
      <div className="flex items-center space-x-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Account Deletion Requests</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Pending Deletion Queue
          </CardTitle>
          <CardDescription>
            Review and process data deletion requests submitted by users. Contact the user before scrubbing their data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center justify-between py-3 border-b">
                  <div className="flex items-center space-x-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="space-y-1">
                      <Skeleton className="h-4 w-36" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <Skeleton className="h-9 w-24" />
                </div>
              ))}
            </div>
          ) : requests.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
              <p className="font-medium">All caught up!</p>
              <p className="text-sm text-muted-foreground">There are no pending account deletion requests.</p>
            </div>
          ) : (
            <div className="divide-y">
              {requests.map(req => {
                const initials = req.name ? req.name.charAt(0).toUpperCase() : '?';
                const isResolving = resolvingId === req.id;

                return (
                  <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between py-4 gap-4">
                    <div className="flex items-start space-x-3">
                      <Avatar>
                        <AvatarImage src={req.avatar_url || undefined} alt={req.name} />
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm">{req.name || 'Unknown User'}</p>
                          <Badge variant="outline" className="text-xs text-yellow-600 border-yellow-500/30 bg-yellow-500/10">
                            Deletion Requested
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{req.email || req.phone || 'No contact info'}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1">
                          <Clock className="h-3 w-3" />
                          <span>
                            {req.delete_requested_at
                              ? new Date(req.delete_requested_at).toLocaleDateString()
                              : new Date(req.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {req.email && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={`mailto:${req.email}?subject=Account Deletion Request - YRDLY`}>
                            <Mail className="h-4 w-4 mr-1.5" />
                            Email
                          </a>
                        </Button>
                      )}
                      {req.phone && (
                        <Button variant="outline" size="sm" asChild>
                          <a href={`tel:${req.phone}`}>
                            <Phone className="h-4 w-4 mr-1.5" />
                            Call
                          </a>
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="secondary" size="sm" disabled={isResolving}>
                            {isResolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Mark Resolved"}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Mark as Resolved?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will clear the pending deletion flag for {req.name}. Only proceed after you have scrubbed their data.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleMarkResolved(req.id)}>
                              Mark Resolved
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
