"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Loader2, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/lib/supabase';

export default function PaymentVerificationPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [verificationStatus, setVerificationStatus] = useState<'loading' | 'success' | 'failed' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  const txRef = searchParams.get('tx_ref');
  const transactionRef = searchParams.get('transaction_id');
  const flwStatus = searchParams.get('status');       // 'successful' | 'cancelled' | 'failed'
  const itemId = searchParams.get('itemId');          // passed from initialize route

  const verifyPayment = useCallback(async () => {
    try {
      setVerificationStatus('loading');
      
      // Use transaction_id if available, otherwise use tx_ref
      const reference = transactionRef || txRef;
      if (!reference) {
        throw new Error('No transaction reference found');
      }

      // Get current session token for auth
      const { data: { session } } = await supabase.auth.getSession();

      // Call API route to verify payment
      const response = await fetch('/api/payment/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ transactionReference: reference }),
      });

      const result = await response.json();

      if (!response.ok) {
        setVerificationStatus('failed');
        setErrorMessage(result.error || 'Payment verification failed');
        return;
      }

      if (result.success) {
        setVerificationStatus('success');
        setTransactionId(result.transactionId);

        // Redirect immediately to Stitch escrow-confirmation page
        setTimeout(() => {
          router.replace(
            `/payment/escrow-confirmation?txn=${result.transactionId}&amount=${result.amount ?? ''}&ref=${txRef ?? ''}`
          );
        }, 1500); // Give success state time to display before redirect
      } else {
        setVerificationStatus('failed');
        setErrorMessage(result.error || 'Payment verification failed');
      }
    } catch (error) {
      console.error('Payment verification error:', error);
      setVerificationStatus('error');
      setErrorMessage('An unexpected error occurred during verification');
    }
  }, [transactionRef, txRef, router]);

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }

    // ── Cancelled / failed from Flutterwave ──────────────
    if (flwStatus === 'cancelled' || flwStatus === 'failed') {
      toast({
        title: flwStatus === 'cancelled' ? 'Payment cancelled' : 'Payment failed',
        description: 'You have been returned to the item page.',
        variant: 'destructive',
      });
      // Go back to the specific item if we have the id, otherwise marketplace
      router.replace(itemId ? `/marketplace/${itemId}` : '/marketplace');
      return;
    }

    if (!txRef && !transactionRef) {
      setVerificationStatus('error');
      setErrorMessage('Missing transaction reference');
      return;
    }

    verifyPayment();
  }, [user, flwStatus, txRef, transactionRef, itemId, router, verifyPayment, toast]);

  const handleRetry = async () => {
    setIsRetrying(true);
    await verifyPayment();
    setIsRetrying(false);
  };

  const handleGoToTransaction = () => {
    if (transactionId) {
      router.push(`/transactions/${transactionId}`);
    } else {
      router.push('/marketplace');
    }
  };

  const handleGoToMarketplace = () => {
    router.push('/marketplace');
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Payment Verification</CardTitle>
          <CardDescription>
            Verifying your payment with Flutterwave...
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {verificationStatus === 'loading' && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary" />
              </div>
              <div className="space-y-2">
                <p className="text-muted-foreground font-medium">
                  Verifying your payment...
                </p>
                <p className="text-xs text-muted-foreground">
                  This may take a few moments, especially for bank transfers. Please do not close this page.
                </p>
              </div>
            </div>
          )}

          {verificationStatus === 'success' && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle className="h-12 w-12 text-green-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-green-700">Payment Successful!</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Your payment has been processed successfully. The item is now yours!
                </p>
              </div>
              <div className="space-y-2">
                <Button onClick={handleGoToTransaction} className="w-full">
                  View Transaction Details
                </Button>
                <Button variant="outline" onClick={handleGoToMarketplace} className="w-full">
                  Continue Shopping
                </Button>
              </div>
            </div>
          )}

          {verificationStatus === 'failed' && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <XCircle className="h-12 w-12 text-red-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-red-700">Payment Failed</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  {errorMessage}
                </p>
              </div>
              <div className="space-y-2">
                <Button onClick={handleRetry} disabled={isRetrying} className="w-full">
                  {isRetrying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    'Try Again'
                  )}
                </Button>
                <Button variant="outline" onClick={handleGoToMarketplace} className="w-full">
                  Back to Marketplace
                </Button>
              </div>
            </div>
          )}

          {verificationStatus === 'error' && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <AlertCircle className="h-12 w-12 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-orange-700">Verification Error</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  {errorMessage}
                </p>
              </div>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  If you completed the payment, please contact support with your transaction reference: {txRef || transactionRef}
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Button onClick={handleRetry} disabled={isRetrying} className="w-full">
                  {isRetrying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    'Try Again'
                  )}
                </Button>
                <Button variant="outline" onClick={handleGoToMarketplace} className="w-full">
                  Back to Marketplace
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
