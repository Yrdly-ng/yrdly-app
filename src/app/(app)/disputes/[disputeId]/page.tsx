"use client";

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { DisputeService, DisputeData, DisputeEvidence } from '@/lib/dispute-service';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { 
  AlertTriangle, 
  Calendar, 
  Clock,
  CheckCircle,
  XCircle,
  User,
  MessageCircle,
  ExternalLink,
  FileText,
  Image as ImageIcon
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';

export default function DisputeDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [dispute, setDispute] = useState<DisputeData | null>(null);
  const [loading, setLoading] = useState(true);

  const disputeId = params.disputeId as string;

  const fetchDisputeDetails = useCallback(async () => {
    try {
      const data = await DisputeService.getDisputeDetails(disputeId);
      if (!data) {
        toast({
          title: "Dispute Not Found",
          description: "The dispute you're looking for doesn't exist.",
          variant: "destructive",
        });
        router.push('/disputes');
        return;
      }
      setDispute(data);
    } catch (error) {
      console.error('Error fetching dispute details:', error);
      toast({
        title: "Error",
        description: "Failed to load dispute details.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [disputeId, toast, router]);

  useEffect(() => {
    if (!user) {
      router.push('/signin');
      return;
    }

    fetchDisputeDetails();
  }, [user, disputeId, router, fetchDisputeDetails]);

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

  const renderEvidence = (evidence: DisputeEvidence, title: string) => {
    if (!evidence || Object.keys(evidence).length === 0) {
      return null;
    }

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {evidence.description && (
            <div>
              <h4 className="font-medium mb-2">Description</h4>
              <p className="text-sm text-muted-foreground">{evidence.description}</p>
            </div>
          )}

          {evidence.photos && evidence.photos.length > 0 && (
            <div>
              <h4 className="font-medium mb-2">Evidence Photos</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {evidence.photos.map((photo, index) => (
                  <div key={index} className="relative aspect-square rounded-lg overflow-hidden">
                    <Image
                      src={photo}
                      alt={`Evidence ${index + 1}`} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      className="object-cover"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {evidence.additionalNotes && (
            <div>
              <h4 className="font-medium mb-2">Additional Notes</h4>
              <p className="text-sm text-muted-foreground">{evidence.additionalNotes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const handleViewTransaction = () => {
    if (dispute) {
      router.push(`/transactions/${dispute.transactionId}`);
    }
  };

  const handleMessageUser = () => {
    if (!dispute || !user) return;
    
    const transaction = dispute.transaction;
    if (!transaction) return;
    
    const otherUserId = user.id === transaction.buyer_id 
      ? transaction.seller_id 
      : transaction.buyer_id;
    
    router.push(`/messages?user=${otherUserId}&item=${transaction.item?.id}`);
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading dispute details...</p>
        </div>
      </div>
    );
  }

  if (!dispute) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="text-center p-6">
            <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Dispute Not Found</h3>
            <p className="text-muted-foreground mb-4">
              The dispute you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
            </p>
            <Button onClick={() => router.push('/disputes')}>
              Back to Disputes
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const transaction = dispute.transaction;
  if (!transaction) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="text-center p-6">
            <AlertTriangle className="h-12 w-12 text-orange-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Transaction Not Found</h3>
            <p className="text-muted-foreground mb-4">
              The transaction associated with this dispute could not be found.
            </p>
            <Button onClick={() => router.push('/disputes')}>
              Back to Disputes
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }
  
  const isBuyer = user?.id === transaction.buyer_id;
  const otherUser = isBuyer ? transaction.seller : transaction.buyer;

  return (
    <div className="min-h-[100dvh] bg-background p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dispute Details</h1>
            <p className="text-muted-foreground">Dispute ID: {dispute.id}</p>
          </div>
          {getStatusBadge(dispute.status)}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Item Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Item Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4">
                <div className="w-20 h-20 relative rounded-lg overflow-hidden">
                  <Image
                    src={transaction.item?.image_urls?.[0] || "/placeholder.svg"}
                    alt={transaction.item?.title || transaction.item?.text || "Item"} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                    className="object-cover"
                  />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">
                    {transaction.item?.title || transaction.item?.text || "Untitled Item"}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {transaction.item?.text || "No description available"}
                  </p>
                  <p className="text-lg font-bold text-primary mt-2">
                    ₦{transaction.amount.toLocaleString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Dispute Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Dispute Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reason:</span>
                <span>{getReasonText(dispute.disputeReason)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Opened:</span>
                <span>{new Date(dispute.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                {getStatusBadge(dispute.status)}
              </div>
              {dispute.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resolved:</span>
                  <span>{new Date(dispute.resolvedAt).toLocaleDateString()}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* User Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {isBuyer ? 'Seller' : 'Buyer'} Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={otherUser.avatar_url || "/placeholder.svg"} />
                  <AvatarFallback>
                    {otherUser.name?.slice(0, 2).toUpperCase() || "U"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h3 className="font-semibold">{otherUser.name}</h3>
                  <p className="text-sm text-muted-foreground">{otherUser.email}</p>
                </div>
              </div>
              <Button 
                onClick={handleMessageUser}
                variant="outline" 
                className="w-full"
              >
                <MessageCircle className="mr-2 h-4 w-4" />
                Message {isBuyer ? 'Seller' : 'Buyer'}
              </Button>
            </CardContent>
          </Card>

          {/* Transaction Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ExternalLink className="h-5 w-5" />
                Transaction Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button 
                onClick={handleViewTransaction}
                className="w-full"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                View Transaction Details
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Evidence Section */}
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Evidence</h2>
          
          {renderEvidence(dispute.buyerEvidence, "Buyer Evidence")}
          {renderEvidence(dispute.sellerEvidence, "Seller Evidence")}
        </div>

        {/* Resolution Section */}
        {dispute.resolution && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                Resolution
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium mb-2">Resolution Details</h4>
                <p className="text-muted-foreground">{dispute.resolution}</p>
              </div>
              
              {(dispute.refundAmount > 0 || dispute.sellerAmount > 0) && (
                <div className="grid grid-cols-2 gap-4">
                  {dispute.refundAmount > 0 && (
                    <div className="p-3 bg-green-50 rounded-lg">
                      <h5 className="font-medium text-green-800">Refund Amount</h5>
                      <p className="text-lg font-bold text-green-600">
                        ₦{dispute.refundAmount.toLocaleString()}
                      </p>
                    </div>
                  )}
                  {dispute.sellerAmount > 0 && (
                    <div className="p-3 bg-blue-50 rounded-lg">
                      <h5 className="font-medium text-blue-800">Seller Amount</h5>
                      <p className="text-lg font-bold text-blue-600">
                        ₦{dispute.sellerAmount.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Admin Notes */}
        {dispute.adminNotes && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                Admin Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">{dispute.adminNotes}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
