"use client";

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import {
  ModerationAdminService,
  ModerationQueueItem,
  UserReportItem,
  CommentReportItem,
} from '@/lib/moderation-admin';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Clock, CheckCircle, XCircle, ImageIcon, MessageSquare, ShieldAlert } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function AdminModerationPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<string>('auto_flags');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  // State for Automated Flags
  const [autoQueue, setAutoQueue] = useState<ModerationQueueItem[]>([]);
  const [autoStatusFilter, setAutoStatusFilter] = useState<string>('pending');
  const [autoPage, setAutoPage] = useState(1);
  const [autoTotalCount, setAutoTotalCount] = useState(0);

  // State for User General Reports
  const [userReports, setUserReports] = useState<UserReportItem[]>([]);
  const [userReportStatusFilter, setUserReportStatusFilter] = useState<string>('open');
  const [userReportPage, setUserReportPage] = useState(1);
  const [userReportTotalCount, setUserReportTotalCount] = useState(0);

  // State for Comment Reports
  const [commentReports, setCommentReports] = useState<CommentReportItem[]>([]);
  const [commentReportPage, setCommentReportPage] = useState(1);
  const [commentReportTotalCount, setCommentReportTotalCount] = useState(0);

  const limit = 20;

  // Fetch Automated Flags Queue
  const fetchAutoQueue = useCallback(async () => {
    try {
      setLoading(true);
      const { data, count } = await ModerationAdminService.getQueue(autoStatusFilter, autoPage, limit);
      setAutoQueue(data);
      setAutoTotalCount(count);
    } catch (error) {
      console.error('Error fetching automated queue:', error);
      toast({ title: "Error", description: "Failed to load automated moderation queue.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [autoStatusFilter, autoPage, toast]);

  // Fetch User General Reports
  const fetchUserReports = useCallback(async () => {
    try {
      setLoading(true);
      const { data, count } = await ModerationAdminService.getUserReports(userReportStatusFilter, userReportPage, limit);
      setUserReports(data);
      setUserReportTotalCount(count);
    } catch (error) {
      console.error('Error fetching user reports:', error);
      toast({ title: "Error", description: "Failed to load user reports.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [userReportStatusFilter, userReportPage, toast]);

  // Fetch Comment Reports
  const fetchCommentReports = useCallback(async () => {
    try {
      setLoading(true);
      const { data, count } = await ModerationAdminService.getCommentReports(commentReportPage, limit);
      setCommentReports(data);
      setCommentReportTotalCount(count);
    } catch (error) {
      console.error('Error fetching comment reports:', error);
      toast({ title: "Error", description: "Failed to load comment reports.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [commentReportPage, toast]);

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }

    if (activeTab === 'auto_flags') fetchAutoQueue();
    else if (activeTab === 'user_reports') fetchUserReports();
    else if (activeTab === 'comment_reports') fetchCommentReports();
  }, [user, activeTab, fetchAutoQueue, fetchUserReports, fetchCommentReports, router]);

  // Actions for Automated Queue
  const handleAutoAction = async (queueId: string, action: 'approve' | 'reject') => {
    try {
      setActionLoading(queueId);
      await ModerationAdminService.moderateContent(queueId, action);
      toast({ title: "Success", description: `Content ${action}d successfully.` });
      fetchAutoQueue();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || `Failed to ${action} content.`, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  // Actions for User Reports
  const handleUserReportAction = async (reportId: string, status: 'resolved' | 'dismissed') => {
    try {
      setActionLoading(reportId);
      await ModerationAdminService.updateUserReportStatus(reportId, status);
      toast({ title: "Updated", description: `Report marked as ${status}.` });
      fetchUserReports();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update report.", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  // Actions for Comment Reports
  const handleCommentReportAction = async (report: CommentReportItem, action: 'delete' | 'dismiss') => {
    try {
      setActionLoading(report.id);
      if (action === 'delete') {
        await ModerationAdminService.deleteReportedComment(report.comment_id, report.id);
        toast({ title: "Comment Deleted", description: "Comment removed and report resolved." });
      } else {
        await ModerationAdminService.dismissCommentReport(report.id);
        toast({ title: "Dismissed", description: "Comment report dismissed." });
      }
      fetchCommentReports();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to process comment report.", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig = {
      'pending': { color: 'bg-yellow-500 text-black', text: 'Pending', icon: Clock },
      'open': { color: 'bg-yellow-500 text-black', text: 'Open', icon: AlertTriangle },
      'approved': { color: 'bg-green-600 text-white', text: 'Approved', icon: CheckCircle },
      'resolved': { color: 'bg-green-600 text-white', text: 'Resolved', icon: CheckCircle },
      'rejected': { color: 'bg-red-600 text-white', text: 'Rejected', icon: XCircle },
      'dismissed': { color: 'bg-gray-600 text-white', text: 'Dismissed', icon: XCircle },
    };

    const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;
    const Icon = config.icon;

    return (
      <Badge className={`${config.color} flex items-center gap-1 font-medium px-2.5 py-0.5 rounded-full text-xs`}>
        <Icon className="h-3 w-3" />
        {config.text}
      </Badge>
    );
  };

  return (
    <div className="p-4 sm:p-6 text-[var(--yrdly-text-primary)] font-yrdly-body space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold font-yrdly-display tracking-tight flex items-center gap-2">
          <ShieldAlert className="h-7 w-7 text-primary" /> Moderation Center
        </h1>
        <p className="text-[var(--yrdly-label)] text-sm">
          Review automated flags, community user reports, and reported comments across Yrdly.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md mb-6">
          <TabsTrigger value="auto_flags">Automated Flags</TabsTrigger>
          <TabsTrigger value="user_reports">User Reports</TabsTrigger>
          <TabsTrigger value="comment_reports">Comment Reports</TabsTrigger>
        </TabsList>

        {/* ── TAB 1: AUTOMATED FLAGS ─────────────────────────────────── */}
        <TabsContent value="auto_flags" className="space-y-4">
          <Card>
            <CardContent className="p-4 flex justify-between items-center">
              <span className="text-sm font-medium">Filter Status</span>
              <Select value={autoStatusFilter} onValueChange={setAutoStatusFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Status" />
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

          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-xl" />
              ))}
            </div>
          ) : autoQueue.length === 0 ? (
            <Card className="text-center p-8">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
              <h3 className="font-semibold text-base">No automated flags</h3>
              <p className="text-sm text-muted-foreground">All AI/automated flags reviewed.</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {autoQueue.map((item) => (
                <Card key={item.id} className="overflow-hidden border border-border">
                  <CardContent className="p-5 flex flex-col sm:flex-row items-start gap-4">
                    {item.image_urls && item.image_urls.length > 0 && (
                      <div className="w-24 h-24 relative rounded-lg overflow-hidden border flex-shrink-0 bg-muted">
                        <Image src={item.image_urls[0]} alt="Media" fill className="object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <span className="text-xs uppercase font-bold text-muted-foreground tracking-wider">{item.table_name}</span>
                          <h3 className="font-semibold text-base">Flagged Reason: <span className="text-foreground">{item.reason}</span></h3>
                        </div>
                        {getStatusBadge(item.status)}
                      </div>
                      {item.text_content && (
                        <div className="p-3 bg-muted/60 rounded-md text-sm my-2 whitespace-pre-wrap">
                          {item.text_content}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        User: {item.user_id} • Date: {new Date(item.created_at).toLocaleString()}
                      </p>
                    </div>

                    {item.status === 'pending' && (
                      <div className="flex sm:flex-col gap-2 w-full sm:w-auto">
                        <Button
                          size="sm"
                          onClick={() => handleAutoAction(item.id, 'approve')}
                          disabled={actionLoading === item.id}
                          className="bg-green-600 hover:bg-green-700 text-white flex-1"
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleAutoAction(item.id, 'reject')}
                          disabled={actionLoading === item.id}
                          className="flex-1"
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── TAB 2: USER GENERAL REPORTS ───────────────────────────── */}
        <TabsContent value="user_reports" className="space-y-4">
          <Card>
            <CardContent className="p-4 flex justify-between items-center">
              <span className="text-sm font-medium">Filter Status</span>
              <Select value={userReportStatusFilter} onValueChange={setUserReportStatusFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="dismissed">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-xl" />
              ))}
            </div>
          ) : userReports.length === 0 ? (
            <Card className="text-center p-8">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
              <h3 className="font-semibold text-base">No user reports</h3>
              <p className="text-sm text-muted-foreground">No reports matching filter.</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {userReports.map((report) => (
                <Card key={report.id} className="overflow-hidden border border-border">
                  <CardContent className="p-5 flex flex-col sm:flex-row items-start gap-4">
                    {report.image_url && (
                      <div className="w-24 h-24 relative rounded-lg overflow-hidden border flex-shrink-0 bg-muted">
                        <Image src={report.image_url} alt="Attached image" fill className="object-cover" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <Badge variant="outline" className="mb-1">{report.category || "General"}</Badge>
                          <h3 className="font-bold text-base">{report.subject}</h3>
                        </div>
                        {getStatusBadge(report.status)}
                      </div>
                      <div className="p-3 bg-muted/60 rounded-md text-sm my-2 whitespace-pre-wrap">
                        {report.description}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Reporter ID: {report.user_id || "Anonymous"} • Reported: {new Date(report.created_at).toLocaleString()}
                      </p>
                    </div>

                    {report.status === 'open' && (
                      <div className="flex sm:flex-col gap-2 w-full sm:w-auto">
                        <Button
                          size="sm"
                          onClick={() => handleUserReportAction(report.id, 'resolved')}
                          disabled={actionLoading === report.id}
                          className="bg-green-600 hover:bg-green-700 text-white flex-1"
                        >
                          Resolve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleUserReportAction(report.id, 'dismissed')}
                          disabled={actionLoading === report.id}
                          className="flex-1"
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── TAB 3: COMMENT REPORTS ───────────────────────────────── */}
        <TabsContent value="comment_reports" className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-xl" />
              ))}
            </div>
          ) : commentReports.length === 0 ? (
            <Card className="text-center p-8">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-2" />
              <h3 className="font-semibold text-base">No reported comments</h3>
              <p className="text-sm text-muted-foreground">Community comment queue is clean.</p>
            </Card>
          ) : (
            <div className="space-y-4">
              {commentReports.map((report) => (
                <Card key={report.id} className="overflow-hidden border border-border">
                  <CardContent className="p-5 flex flex-col sm:flex-row items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center flex-shrink-0">
                      <MessageSquare className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <h3 className="font-semibold text-base">Reported Comment</h3>
                          <p className="text-sm text-muted-foreground">Reason: <span className="text-foreground font-medium">{report.reason}</span></p>
                        </div>
                        {getStatusBadge(report.status || 'open')}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        Comment ID: {report.comment_id} • Post ID: {report.post_id || 'N/A'} • Reported: {new Date(report.created_at).toLocaleString()}
                      </p>
                    </div>

                    <div className="flex sm:flex-col gap-2 w-full sm:w-auto">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleCommentReportAction(report, 'delete')}
                        disabled={actionLoading === report.id}
                        className="flex-1"
                      >
                        Delete Comment
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleCommentReportAction(report, 'dismiss')}
                        disabled={actionLoading === report.id}
                        className="flex-1"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
