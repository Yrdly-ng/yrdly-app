"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { DisputeService, DisputeData } from '@/lib/dispute-service';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  AlertTriangle, 
  Calendar, 
  Clock,
  MessageCircle,
  ExternalLink,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function DisputeManagementPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [disputes, setDisputes] = useState<DisputeData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDisputes = useCallback(async () => {
    try {
      const data = await DisputeService.getDisputesByUser(user!.id);
      setDisputes(data);
    } catch (error) {
      console.error('Error fetching disputes:', error);
      toast({
        title: "Error",
        description: "Failed to load disputes.",
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

    fetchDisputes();
  }, [user, router, fetchDisputes]);

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'open': { color: 'bg-yellow-500', text: 'Open', icon: Clock },
      'under_review': { color: 'bg-blue-500', text: 'Under Review', icon: AlertTriangle },
      'resolved': { color: 'bg-green-500', text: 'Resolved', icon: CheckCircle },
      'closed': { color: 'bg-gray-500', text: 'Closed', icon: XCircle },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.open;
    const Icon = config.icon;
    
    return (
      <Badge className={`${config.color} text-foreground`}>
        <Icon className="mr-1 h-3 w-3" />
        {config.text}
      </Badge>
    );
  };

  const getReasonText = (reason: string) => {
    const reasonMap: { [key: string]: string } = {
      'item_not_received': 'Item not received',
      'item_different': 'Item different from description',
      'item_damaged': 'Item arrived damaged',
      'seller_unresponsive': 'Seller not responding',
      'payment_issue': 'Payment issue',
      'delivery_issue': 'Delivery problem',
      'other': 'Other',
    };
    return reasonMap[reason] || reason;
  };

  const handleViewDispute = (disputeId: string) => {
    router.push(`/disputes/${disputeId}`);
  };

  const handleViewTransaction = (transactionId: string) => {
    router.push(`/transactions/${transactionId}`);
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold">My Disputes</h1>
            <p className="text-muted-foreground">Disputes you&apos;ve opened or are involved in</p>
          </div>
          
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Skeleton className="h-16 w-16 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-6 w-20" />
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
          <h1 className="text-2xl font-bold">My Disputes</h1>
          <p className="text-muted-foreground">Disputes you&apos;ve opened or are involved in</p>
        </div>

        {disputes.length === 0 ? (
          <Card>
            <CardContent className="text-center p-8">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Disputes</h3>
              <p className="text-muted-foreground">
                You haven&apos;t opened any disputes yet. If you have an issue with a transaction, 
                you can open a dispute from the transaction details page.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {disputes.map((dispute) => (
              <Card key={dispute.id} className="overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    {/* Item Image */}
                    <div className="w-16 h-16 relative rounded-lg overflow-hidden flex-shrink-0">
                      <Image
                        src={dispute.transaction?.item?.image_urls?.[0] || "/placeholder.svg"}
                        alt={dispute.transaction?.item?.title || dispute.transaction?.item?.text || "Item"} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                        className="object-cover"
                      />
                    </div>

                    {/* Dispute Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <h3 className="font-semibold truncate">
                            {dispute.transaction?.item?.title || dispute.transaction?.item?.text || "Untitled Item"}
                          </h3>
                          <p className="text-sm text-muted-foreground">
                            Transaction #{dispute.transactionId.slice(0, 8)}
                          </p>
                        </div>
                        {getStatusBadge(dispute.status)}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <AlertTriangle className="h-4 w-4 text-orange-500" />
                          <span className="font-medium">Reason:</span>
                          <span>{getReasonText(dispute.disputeReason)}</span>
                        </div>

                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          <span>Opened {new Date(dispute.createdAt).toLocaleDateString()}</span>
                        </div>

                        {dispute.resolution && (
                          <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                            <p className="text-sm font-medium mb-1">Resolution:</p>
                            <p className="text-sm text-muted-foreground">{dispute.resolution}</p>
                            {dispute.refundAmount > 0 && (
                              <p className="text-sm text-green-600 font-medium mt-1">
                                Refund: ₦{dispute.refundAmount.toLocaleString()}
                              </p>
                            )}
                          </div>
                        )}

                        {dispute.adminNotes && (
                          <div className="mt-2 p-3 bg-blue-50 rounded-lg">
                            <p className="text-sm font-medium mb-1">Admin Notes:</p>
                            <p className="text-sm text-muted-foreground">{dispute.adminNotes}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-2">
                      <Button 
                        onClick={() => handleViewDispute(dispute.id)}
                        variant="outline" 
                        size="sm"
                      >
                        <ExternalLink className="mr-1 h-3 w-3" />
                        View Details
                      </Button>
                      <Button 
                        onClick={() => handleViewTransaction(dispute.transactionId)}
                        variant="ghost" 
                        size="sm"
                      >
                        <MessageCircle className="mr-1 h-3 w-3" />
                        Transaction
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
