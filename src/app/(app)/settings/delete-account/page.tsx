"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
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

export default function DeleteAccountPage() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleDeleteRequest = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const { error } = await supabase
        .from('users')
        .update({
          delete_requested: true,
          delete_requested_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      if (error) throw error;

      toast({
        title: "Request Submitted",
        description: "Your account deletion request has been submitted. You will be signed out now.",
      });

      await signOut();
      router.push('/login');
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to submit deletion request.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  return (
    <div className="container max-w-2xl py-6 space-y-6 font-yrdly-body text-foreground">
      <div className="flex items-center space-x-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight font-yrdly-display text-foreground">Delete Account</h1>
      </div>

      <Card className="border border-destructive/30 bg-[var(--yrdly-glass-bg)] backdrop-blur-xl shadow-lg">
        <CardHeader>
          <div className="flex items-center space-x-3 text-destructive mb-2">
            <div className="p-2 rounded-full bg-destructive/10">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <CardTitle className="text-xl font-yrdly-display">Account Deletion Request</CardTitle>
          </div>
          <CardDescription className="text-base text-[var(--yrdly-label)]">
            Submitting an account deletion request will schedule your account and all associated data (posts, messages, transaction history) to be permanently deleted from our servers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--yrdly-label)]">
            This action is irreversible. For security reasons, the deletion process may take up to 30 days to complete, but you will lose access to your account immediately.
          </p>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="w-full sm:w-auto" disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Request Account Deletion
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-dark)] text-foreground font-yrdly-body">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-yrdly-display">Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription className="text-[var(--yrdly-label)]">
                  This action cannot be undone. All your data, messages, posts, and transactions will be permanently scheduled for deletion.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-[var(--yrdly-glass-border)] bg-background/50">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteRequest}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete My Account
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
