"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { PayoutService, PayoutRequest } from '@/lib/payout-service';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  DollarSign, 
  Calendar, 
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';

export default function PayoutHistoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPayouts = useCallback(async () => {
    try {
      const data = await PayoutService.getSellerPayoutHistory(user!.id);
      setPayouts(data);
    } catch (error) {
      console.error('Error fetching payout history:', error);
      toast({
        title: "Error",
        description: "Failed to load payout history.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (!user) {
      router.push('/signin');
      return;
    }

    fetchPayouts();
  }, [user, router, fetchPayouts]);

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'pending': { color: 'bg-yellow-500', text: 'Pending', icon: Clock },
      'processing': { color: 'bg-blue-500', text: 'Processing', icon: Clock },
      'completed': { color: 'bg-green-500', text: 'Completed', icon: CheckCircle },
      'failed': { color: 'bg-red-500', text: 'Failed', icon: XCircle },
      'cancelled': { color: 'bg-gray-500', text: 'Cancelled', icon: XCircle },
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

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Payout History</h1>
            <p className="text-muted-foreground">Your payout requests and history</p>
          </div>
          
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-6 w-20" />
                      <Skeleton className="h-4 w-16" />
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
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Payout History</h1>
          <p className="text-muted-foreground">Your payout requests and history</p>
        </div>

        {payouts.length === 0 ? (
          <Card>
            <CardContent className="text-center p-8">
              <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Payouts Yet</h3>
              <p className="text-muted-foreground mb-4">
                You haven&apos;t received any payouts yet. Complete some sales to see your payout history here.
              </p>
              <Button onClick={() => router.push('/marketplace')}>
                Start Selling
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {payouts.map((payout) => (
              <Card key={payout.id} className="overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                        <DollarSign className="h-6 w-6 text-primary" />
                      </div>
                      
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold">
                            ₦{payout.amount.toLocaleString()}
                          </h3>
                          {getStatusBadge(payout.status)}
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            <span>Requested {formatDate(payout.requestedAt)}</span>
                          </div>
                          
                          {payout.processedAt && (
                            <div className="flex items-center gap-1">
                              <CheckCircle className="h-3 w-3" />
                              <span>Processed {formatDate(payout.processedAt)}</span>
                            </div>
                          )}
                        </div>

                        {payout.transactionReference && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Reference: {payout.transactionReference}
                          </div>
                        )}

                        {payout.failureReason && (
                          <div className="text-xs text-red-600 mt-1">
                            Error: {payout.failureReason}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">
                        Payout #{payout.id.slice(0, 8)}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Summary Stats */}
        {payouts.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-green-600">
                  ₦{payouts.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0).toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Total Paid Out</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-yellow-600">
                  ₦{payouts.filter(p => p.status === 'pending' || p.status === 'processing').reduce((sum, p) => sum + p.amount, 0).toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">Pending</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {payouts.filter(p => p.status === 'completed').length}
                </div>
                <div className="text-sm text-muted-foreground">Completed Payouts</div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
