"use client";

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { DisputeService, DisputeData, DisputeEvidence } from '@/lib/dispute-service';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Image as ImageIcon,
  Save,
  DollarSign
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import Image from 'next/image';

export default function AdminDisputeReviewPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [dispute, setDispute] = useState<DisputeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');
  const [resolution, setResolution] = useState('');
  const [refundAmount, setRefundAmount] = useState(0);
  const [sellerAmount, setSellerAmount] = useState(0);

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
        router.push('/admin/disputes');
        return;
      }
      setDispute(data);
      setAdminNotes(data.adminNotes || '');
      setResolution(data.resolution || '');
      setRefundAmount(data.refundAmount || 0);
      setSellerAmount(data.sellerAmount || 0);
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
      return (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{title}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">No evidence submitted</p>
          </CardContent>
        </Card>
      );
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

  const handleSaveNotes = async () => {
    if (!dispute) return;

    setSaving(true);
    try {
      await DisputeService.addAdminNotes(disputeId, adminNotes);
      toast({
        title: "Notes Saved",
        description: "Admin notes have been updated.",
      });
    } catch (error) {
      console.error('Error saving notes:', error);
      toast({
        title: "Error",
        description: "Failed to save notes.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleResolveDispute = async () => {
    if (!dispute || !user) return;

    if (!resolution.trim()) {
      toast({
        title: "Missing Resolution",
        description: "Please provide a resolution before resolving the dispute.",
        variant: "destructive",
      });
      return;
    }

    const totalAmount = dispute.transaction?.amount || 0;
    if (refundAmount + sellerAmount !== totalAmount) {
      toast({
        title: "Invalid Amounts",
        description: `Refund amount (₦${refundAmount.toLocaleString()}) + Seller amount (₦${sellerAmount.toLocaleString()}) must equal total transaction amount (₦${totalAmount.toLocaleString()}).`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      await DisputeService.resolveDispute(
        disputeId,
        user.id,
        resolution,
        refundAmount,
        sellerAmount
      );

      toast({
        title: "Dispute Resolved",
        description: "The dispute has been resolved successfully.",
      });

      // Refresh dispute details
      await fetchDisputeDetails();
    } catch (error) {
      console.error('Error resolving dispute:', error);
      toast({
        title: "Error",
        description: "Failed to resolve dispute.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
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
              The dispute you&apos;re looking for doesn&apos;t exist.
            </p>
            <Button onClick={() => router.push('/admin/disputes')}>
              Back to Disputes
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const transaction = dispute.transaction;
  const totalAmount = transaction?.amount || 0;

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
            <Button onClick={() => router.push('/admin/disputes')}>
              Back to Disputes
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Dispute Review</h1>
            <p className="text-muted-foreground">Dispute ID: {dispute.id}</p>
          </div>
          {getStatusBadge(dispute.status)}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
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
                      ₦{totalAmount.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Evidence Section */}
            <div className="space-y-6">
              <h2 className="text-xl font-semibold">Evidence</h2>
              {renderEvidence(dispute.buyerEvidence, "Buyer Evidence")}
              {renderEvidence(dispute.sellerEvidence, "Seller Evidence")}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
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
                  Users Involved
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={transaction.buyer?.avatar_url || "/placeholder.svg"} />
                    <AvatarFallback>
                      {transaction.buyer?.name?.slice(0, 2).toUpperCase() || "B"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h4 className="font-medium">Buyer</h4>
                    <p className="text-sm text-muted-foreground">{transaction.buyer?.name || "Unknown"}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarImage src={transaction.seller?.avatar_url || "/placeholder.svg"} />
                    <AvatarFallback>
                      {transaction.seller?.name?.slice(0, 2).toUpperCase() || "S"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h4 className="font-medium">Seller</h4>
                    <p className="text-sm text-muted-foreground">{transaction.seller?.name || "Unknown"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Admin Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageCircle className="h-5 w-5" />
                  Admin Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Add your notes about this dispute..."
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  rows={4}
                />
                <Button 
                  onClick={handleSaveNotes}
                  disabled={saving}
                  size="sm"
                  className="w-full"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save Notes
                </Button>
              </CardContent>
            </Card>

            {/* Resolution (if not resolved) */}
            {dispute.status !== 'resolved' && dispute.status !== 'closed' && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5" />
                    Resolve Dispute
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="resolution">Resolution *</Label>
                    <Textarea
                      id="resolution"
                      placeholder="Describe how you're resolving this dispute..."
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="refund">Refund Amount</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="refund"
                          type="number"
                          placeholder="0"
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(Number(e.target.value))}
                          className="pl-10"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="seller">Seller Amount</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="seller"
                          type="number"
                          placeholder="0"
                          value={sellerAmount}
                          onChange={(e) => setSellerAmount(Number(e.target.value))}
                          className="pl-10"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-gray-50 rounded-lg">
                    <div className="flex justify-between text-sm">
                      <span>Total Transaction:</span>
                      <span className="font-medium">₦{totalAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>Refund + Seller:</span>
                      <span className="font-medium">₦{(refundAmount + sellerAmount).toLocaleString()}</span>
                    </div>
                    {refundAmount + sellerAmount !== totalAmount && (
                      <p className="text-xs text-red-500 mt-1">
                        Amounts must equal total transaction amount
                      </p>
                    )}
                  </div>

                  <Button 
                    onClick={handleResolveDispute}
                    disabled={saving || !resolution.trim() || refundAmount + sellerAmount !== totalAmount}
                    className="w-full"
                  >
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Resolve Dispute
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Resolution (if resolved) */}
            {dispute.status === 'resolved' && (
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
                    <p className="text-sm text-muted-foreground">{dispute.resolution}</p>
                  </div>
                  
                  {(dispute.refundAmount > 0 || dispute.sellerAmount > 0) && (
                    <div className="space-y-2">
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
          </div>
        </div>
      </div>
    </div>
  );
}
