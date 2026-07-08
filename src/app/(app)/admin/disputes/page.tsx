"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { DisputeService, DisputeData } from '@/lib/dispute-service';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  AlertTriangle, 
  Calendar, 
  Clock,
  CheckCircle,
  XCircle,
  Search,
  ExternalLink,
  Filter
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function AdminDisputesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  
  const [disputes, setDisputes] = useState<DisputeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 20;

  const fetchDisputes = useCallback(async () => {
    try {
      setLoading(true);
      const { data, count } = await DisputeService.getDisputesByStatus(statusFilter, page, limit);
      setDisputes(data);
      setTotalCount(count);
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
  }, [statusFilter, toast]);

  useEffect(() => {
    if (!user) {
      router.push('/signin');
      return;
    }

    fetchDisputes();
  }, [user, statusFilter, page, router, fetchDisputes]);

  // Reset page when filter changes
  useEffect(() => {
    setPage(1);
  }, [statusFilter, searchTerm]);

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

  const filteredDisputes = disputes.filter(dispute => {
    const matchesSearch = searchTerm === '' || 
      dispute.transaction?.item?.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      dispute.transaction?.item?.text?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      dispute.disputeReason.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesSearch;
  });

  const handleViewDispute = (disputeId: string) => {
    router.push(`/admin/disputes/${disputeId}`);
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-background p-4">
        <div className="max-w-6xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold">Admin Dispute Dashboard</h1>
            <p className="text-muted-foreground">Manage and resolve disputes</p>
          </div>
          
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <Skeleton className="h-16 w-16 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-6 w-20" />
                    </div>
                    <Skeleton className="h-8 w-24" />
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
        <div>
          <h1 className="text-2xl font-bold">Admin Dispute Dashboard</h1>
          <p className="text-muted-foreground">Manage and resolve disputes</p>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search disputes..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="under_review">Under Review</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Disputes List */}
        {filteredDisputes.length === 0 ? (
          <Card>
            <CardContent className="text-center p-8">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No Disputes Found</h3>
              <p className="text-muted-foreground">
                {searchTerm || statusFilter !== 'all' 
                  ? 'No disputes match your current filters.'
                  : 'There are no disputes to review at this time.'
                }
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {filteredDisputes.map((dispute) => (
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
                            Transaction #{dispute.transactionId.slice(0, 8)} • 
                            ₦{dispute.transaction?.amount?.toLocaleString()}
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

                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <span>Buyer:</span>
                            <span className="font-medium">{dispute.transaction?.buyer?.name}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span>Seller:</span>
                            <span className="font-medium">{dispute.transaction?.seller?.name}</span>
                          </div>
                        </div>

                        {dispute.resolution && (
                          <div className="mt-2 p-2 bg-gray-50 rounded text-sm">
                            <span className="font-medium">Resolution:</span>
                            <span className="ml-2">{dispute.resolution}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="flex flex-col gap-2">
                      <Button 
                        onClick={() => handleViewDispute(dispute.id)}
                        size="sm"
                      >
                        <ExternalLink className="mr-1 h-3 w-3" />
                        Review
                      </Button>
                    </div>
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
              Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} disputes
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page * limit >= totalCount}
                onClick={() => setPage(p => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {disputes.filter(d => d.status === 'open').length}
              </div>
              <div className="text-sm text-muted-foreground">Open Disputes</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">
                {disputes.filter(d => d.status === 'under_review').length}
              </div>
              <div className="text-sm text-muted-foreground">Under Review</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">
                {disputes.filter(d => d.status === 'resolved').length}
              </div>
              <div className="text-sm text-muted-foreground">Resolved</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-gray-600">
                {disputes.filter(d => d.status === 'closed').length}
              </div>
              <div className="text-sm text-muted-foreground">Closed</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
