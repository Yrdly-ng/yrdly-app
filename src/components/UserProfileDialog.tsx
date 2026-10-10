
import { VerifiedBadge } from '@/components/VerifiedBadge';

import { useEffect, useState, useRef as reactUseRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-supabase-auth';
import { NotificationTriggers } from '@/lib/notification-triggers';
import type { User } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';
import { MapPin, MessageSquare, UserPlus, Check, X, Clock, MoreHorizontal, ShieldBan, UserMinus, Star, BadgeCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useMediaQuery } from '@/hooks/use-media-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader as AlertDialogHeaderComponent,
    AlertDialogTitle as AlertDialogTitleComponent,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFriendshipGlobal } from '@/hooks/use-friendship-global';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface UserProfileDialogProps {
    user: User;
    open: boolean;
    onOpenChange: (wasChanged: boolean) => void;
}

export function UserProfileDialog({ user: profileUser, open, onOpenChange }: UserProfileDialogProps) {
    const { user: currentUser, profile: currentUserProfile } = useAuth();
    const isAdmin = Boolean((currentUserProfile as any)?.is_admin);
    const { toast } = useToast();
    const router = useRouter();
    const isDesktop = useMediaQuery("(min-width: 768px)");

    const [adminModalOpen, setAdminModalOpen] = useState(false);
    const [adminAction, setAdminAction] = useState<'suspend' | 'ban' | 'unsuspend'>('suspend');
    const [adminReason, setAdminReason] = useState('');
    const [adminLoading, setAdminLoading] = useState(false);
    const [userStatus, setUserStatus] = useState<string>((profileUser as any)?.status || 'active');
    
    // Ensure we only trigger the notification once per open session
    const hasTriggeredViewRef = reactUseRef<boolean>(false);

    // ── Single source of truth for friendship state ──
    const friendship = useFriendshipGlobal(profileUser?.id);
    const { status: friendshipStatus, isLoading: friendshipLoading } = friendship;

    // ── Block state ──
    const [isBlocked, setIsBlocked] = useState(false);
    const [reviews, setReviews] = useState<any[]>([]);

    const handleAdminSuspendAction = async () => {
        if (!profileUser?.id) return;
        setAdminLoading(true);
        try {
            const res = await fetch('/api/admin/users/suspend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUserId: profileUser.id,
                    action: adminAction,
                    reason: adminReason,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to perform admin action');
            toast({
                title: 'User Status Updated',
                description: `User ${profileUser.name} has been ${adminAction}ed.`,
            });
            setUserStatus(adminAction === 'unsuspend' ? 'active' : adminAction);
            setAdminModalOpen(false);
        } catch (err: any) {
            toast({
                title: 'Action Failed',
                description: err.message || 'Failed to update status',
                variant: 'destructive',
            });
        } finally {
            setAdminLoading(false);
        }
    };

    useEffect(() => {
        if (!open || !currentUser || !profileUser) return;
        // Close if viewing own profile
        if (profileUser.id === currentUser.id) { onOpenChange(false); return; }
        // Fetch block status
        const fetchBlockStatus = async () => {
            const { data } = await supabase
                .from('users')
                .select('blocked_users')
                .eq('id', currentUser.id)
                .maybeSingle();
            setIsBlocked(data?.blocked_users?.includes(profileUser.id) ?? false);
        };
        fetchBlockStatus();
        
        const fetchReviews = async () => {
            const { data } = await supabase.from('user_reviews').select('*, buyer:buyer_id(id, name, avatar_url)').eq('seller_id', profileUser.id).order('created_at', { ascending: false });
            setReviews(data || []);
        };
        fetchReviews();
        
        // Trigger profile view notification
        if (!hasTriggeredViewRef.current && currentUser.id !== profileUser.id) {
            hasTriggeredViewRef.current = true;
            NotificationTriggers.onProfileView(profileUser.id, currentUser.id).catch(console.error);
        }
    }, [open, currentUser, profileUser, onOpenChange, hasTriggeredViewRef]);

    // Reset the triggered ref when dialog closes
    useEffect(() => {
        if (!open) {
            hasTriggeredViewRef.current = false;
        }
    }, [open, hasTriggeredViewRef]);

    // ── Block / Unblock ──
    const handleBlockUser = async () => {
        if (!currentUser || !profileUser) return;
        try {
            const { data } = await supabase.from('users').select('blocked_users').eq('id', currentUser.id).maybeSingle();
            await supabase.from('users')
                .update({ blocked_users: [...(data?.blocked_users || []), profileUser.id] })
                .eq('id', currentUser.id);
            setIsBlocked(true);
            toast({ title: "User blocked." });
            onOpenChange(true);
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Could not block user." });
        }
    };

    const handleUnblockUser = async () => {
        if (!currentUser || !profileUser) return;
        try {
            const { data } = await supabase.from('users').select('blocked_users').eq('id', currentUser.id).maybeSingle();
            await supabase.from('users')
                .update({ blocked_users: (data?.blocked_users || []).filter((id: string) => id !== profileUser.id) })
                .eq('id', currentUser.id);
            setIsBlocked(false);
            toast({ title: "User unblocked." });
            onOpenChange(true);
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Could not unblock user." });
        }
    };

    // ── Message ──
    const handleMessageClick = async () => {
        if (!currentUser || !profileUser) return;
        const sortedParticipantIds = [currentUser.id, profileUser.id].sort();
        try {
            const { data: allConversations } = await supabase
                .from('conversations')
                .select('id, participant_ids, type')
                .contains('participant_ids', [currentUser.id]);
            const existing = allConversations?.find(conv =>
                conv.participant_ids.includes(currentUser.id) &&
                conv.participant_ids.includes(profileUser.id) &&
                conv.participant_ids.length === 2 &&
                conv.type === 'friend'
            );
            let conversationId: string;
            if (!existing) {
                const { data: newConv, error } = await supabase
                    .from('conversations')
                    .insert({ participant_ids: sortedParticipantIds, type: 'friend', created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                    .select('id')
                    .single();
                if (error) throw error;
                conversationId = newConv.id;
            } else {
                conversationId = existing.id;
            }
            onOpenChange(false);
            router.push(`/messages/${conversationId}`);
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Could not start a conversation." });
        }
    };

    const displayLocation = (location?: User['location']) => {
        if (!location) return "Location not set";
        return [location.city, location.lga, location.state].filter(Boolean).join(", ");
    };

    // ── Action Buttons — powered by shared hook ──
    const renderActionButtons = () => {
        if (!profileUser || profileUser.id === currentUser?.id) return null;
        if (isBlocked) {
            return (
                <div className="flex flex-col items-center text-center">
                    <p className="text-sm text-destructive font-semibold">You have blocked this user.</p>
                    <Button onClick={handleUnblockUser} variant="outline" className="mt-2 rounded-lg">Unblock</Button>
                </div>
            );
        }
        switch (friendshipStatus) {
            case 'friends':
                return (
                    <div className="flex gap-2 w-full">
                        <Button
                            variant="destructive"
                            onClick={() => friendship.removeFriend()}
                            disabled={friendshipLoading}
                            className="flex-1 rounded-lg"
                        >
                            <UserMinus className="mr-2 h-4 w-4" />
                            {friendshipLoading ? "..." : "Remove Friend"}
                        </Button>
                        <Button variant="outline" onClick={handleMessageClick} className="flex-1 rounded-lg">
                            <MessageSquare className="mr-2 h-4 w-4" /> Message
                        </Button>
                    </div>
                );
            case 'request_sent':
                return (
                    <div className="flex gap-2 w-full">
                        <Button disabled className="rounded-lg flex-1">
                            <Clock className="mr-2 h-4 w-4" /> Pending
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => friendship.cancelRequest()}
                            disabled={friendshipLoading}
                            className="flex-1 rounded-lg"
                        >
                            <X className="mr-2 h-4 w-4" /> Cancel
                        </Button>
                    </div>
                );
            case 'request_received':
                return (
                    <div className="flex gap-2 w-full">
                        <Button
                            onClick={() => friendship.acceptRequest()}
                            disabled={friendshipLoading}
                            className="flex-1 rounded-lg"
                        >
                            <Check className="mr-2 h-4 w-4" />
                            {friendshipLoading ? "..." : "Accept"}
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => friendship.declineRequest()}
                            disabled={friendshipLoading}
                            className="flex-1 rounded-lg"
                        >
                            <X className="mr-2 h-4 w-4" />
                            {friendshipLoading ? "..." : "Decline"}
                        </Button>
                    </div>
                );
            case 'none':
            default:
                return (
                    <Button
                        onClick={() => friendship.addFriend()}
                        disabled={friendshipLoading}
                        className="rounded-lg w-full"
                    >
                        <UserPlus className="mr-2 h-4 w-4" />
                        {friendshipLoading ? "..." : "Add Friend"}
                    </Button>
                );
        }
    };

    const ProfileContent = () => (
        <>
            {!profileUser ? (
                <div className="text-center py-10">User not found.</div>
            ) : (
                <Card className="border-none shadow-none bg-transparent">
                    <CardHeader className="flex flex-col items-center text-center p-6 bg-muted/50 relative rounded-t-xl">
                        {profileUser.id !== currentUser?.id && (
                            <div className="absolute top-2 right-2">
                                <AlertDialog>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button aria-label="More options" variant="ghost" size="icon"><MoreHorizontal className="h-5 w-5" /></Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {friendshipStatus === 'friends' && (
                                                <AlertDialogTrigger asChild>
                                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
                                                        <UserMinus className="mr-2 h-4 w-4" /> Unfriend
                                                    </DropdownMenuItem>
                                                </AlertDialogTrigger>
                                            )}
                                            <AlertDialogTrigger asChild>
                                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive">
                                                    <ShieldBan className="mr-2 h-4 w-4" /> {isBlocked ? "Unblock" : "Block"} User
                                                </DropdownMenuItem>
                                            </AlertDialogTrigger>
                                            {isAdmin && (
                                                <>
                                                    <DropdownMenuItem
                                                        onSelect={() => {
                                                            setAdminAction(userStatus === 'suspended' || userStatus === 'banned' ? 'unsuspend' : 'suspend');
                                                            setAdminModalOpen(true);
                                                        }}
                                                        className="text-amber-500 font-bold"
                                                    >
                                                        <ShieldBan className="mr-2 h-4 w-4 text-amber-500" />
                                                        {userStatus === 'suspended' || userStatus === 'banned' ? 'Unsuspend / Lift Ban' : 'Suspend User (Admin)'}
                                                    </DropdownMenuItem>
                                                    {userStatus !== 'banned' && (
                                                        <DropdownMenuItem
                                                            onSelect={() => {
                                                                setAdminAction('ban');
                                                                setAdminModalOpen(true);
                                                            }}
                                                            className="text-destructive font-bold"
                                                        >
                                                            <ShieldBan className="mr-2 h-4 w-4 text-destructive" /> Ban User (Admin)
                                                        </DropdownMenuItem>
                                                    )}
                                                </>
                                            )}
                                        </DropdownMenuContent>
                                    </DropdownMenu>

                                    <AlertDialogContent>
                                        <AlertDialogHeaderComponent>
                                            <AlertDialogTitleComponent>Are you sure?</AlertDialogTitleComponent>
                                            <AlertDialogDescription>
                                                {isBlocked
                                                    ? `This will unblock ${profileUser.name}.`
                                                    : friendshipStatus === 'friends'
                                                    ? `This will remove ${profileUser.name} from your friends list.`
                                                    : `This will block ${profileUser.name}. You won't see their content or be able to interact with them.`
                                                }
                                            </AlertDialogDescription>
                                        </AlertDialogHeaderComponent>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={isBlocked ? handleUnblockUser : (friendshipStatus === 'friends' ? () => friendship.removeFriend() : handleBlockUser)}
                                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                            >
                                                {isBlocked ? "Unblock" : (friendshipStatus === 'friends' ? "Unfriend" : "Block")}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        )}
                        <Avatar className="h-24 w-24 mb-4 border-2 border-background">
                            <AvatarImage src={profileUser.avatar_url} alt={profileUser.name} />
                            <AvatarFallback>{profileUser.name?.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <h1 className="text-2xl font-bold flex items-center justify-center gap-1.5">
                            {profileUser.name}
                            {((profileUser as any).is_verified || (profileUser as any).verified_seller || (profileUser as any).phone_verified) && (
                                <VerifiedBadge size={20} type={(profileUser as any).verified_seller ? 'seller' : 'user'} />
                            )}
                        </h1>
                        {profileUser.location && (
                            <div className="flex items-center text-sm text-muted-foreground mt-1">
                                <MapPin className="h-4 w-4 mr-1" />
                                <span>{displayLocation(profileUser.location)}</span>
                            </div>
                        )}
                    </CardHeader>
                    
                    <Tabs defaultValue="about" className="w-full">
                        <TabsList className="w-full grid grid-cols-2">
                            <TabsTrigger value="about">About</TabsTrigger>
                            <TabsTrigger value="reviews">Reviews</TabsTrigger>
                        </TabsList>
                        
                        <TabsContent value="about" className="p-6 space-y-6 max-h-[40vh] overflow-y-auto">
                            <div>
                                <h2 className="font-semibold text-lg mb-2">Bio</h2>
                                <p className="text-muted-foreground">{profileUser.bio || "This user hasn't written a bio yet."}</p>
                            </div>
                            {profileUser.interests && profileUser.interests.length > 0 && (
                                <div>
                                    <h2 className="font-semibold text-lg mb-3">Interests</h2>
                                    <div className="flex flex-wrap gap-2">
                                        {profileUser.interests.map((interest, index) => (
                                            <span key={index} className="px-3 py-1 bg-primary/10 text-primary text-sm rounded-full border border-primary/20">
                                                {interest}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </TabsContent>
                        
                        <TabsContent value="reviews" className="p-4 space-y-4 max-h-[40vh] overflow-y-auto">
                            {reviews.length > 0 ? (
                                reviews.map(review => (
                                    <div key={review.id} className="p-4 rounded-xl bg-card border">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <Avatar className="w-8 h-8">
                                                    <AvatarImage src={review.buyer?.avatar_url} />
                                                    <AvatarFallback>{review.buyer?.name?.charAt(0) || 'U'}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <div className="text-sm font-semibold">{review.buyer?.name || 'Anonymous'}</div>
                                                    <div className="flex items-center text-xs text-muted-foreground">
                                                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 mr-1" />
                                                        {review.rating} / 5
                                                    </div>
                                                </div>
                                            </div>
                                            {review.verified_purchase && (
                                                <div className="flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-full">
                                                    <Check className="w-3 h-3" />
                                                    Verified Purchase
                                                </div>
                                            )}
                                        </div>
                                        {review.comment && (
                                            <p className="text-sm text-foreground/90">{review.comment}</p>
                                        )}
                                    </div>
                                ))
                            ) : (
                                <div className="text-center py-8 text-muted-foreground flex flex-col items-center">
                                    <Star className="w-8 h-8 text-muted-foreground/30 mb-2" />
                                    No reviews yet.
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>

                    <CardFooter className="p-6 justify-center">
                        {renderActionButtons()}
                    </CardFooter>
                </Card>
            )}
        </>
    );

    if (isDesktop) {
        return (
            <Dialog open={open} onOpenChange={() => onOpenChange(false)}>
                <DialogContent className="sm:max-w-md p-0">
                    <DialogHeader className="sr-only">
                        <DialogTitle>{profileUser?.name ? `Profile of ${profileUser.name}` : "User Profile"}</DialogTitle>
                        <DialogDescription>View user profile details.</DialogDescription>
                    </DialogHeader>
                    <ProfileContent />
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <>
            <Drawer open={open} onOpenChange={() => onOpenChange(false)}>
                <DrawerContent className="p-0 border-none">
                    <DrawerHeader className="sr-only">
                        <DrawerTitle>{profileUser?.name ? `Profile of ${profileUser.name}` : "User Profile"}</DrawerTitle>
                        <DrawerDescription>View user profile details.</DrawerDescription>
                    </DrawerHeader>
                    <div className="overflow-y-auto max-h-[85vh] pb-8">
                        <ProfileContent />
                    </div>
                </DrawerContent>
            </Drawer>

            {/* Admin Suspend / Ban Confirmation Dialog */}
            {adminModalOpen && (
                <Dialog open={adminModalOpen} onOpenChange={setAdminModalOpen}>
                    <DialogContent className="sm:max-w-md bg-card border-border">
                        <DialogHeader>
                            <DialogTitle className="text-lg font-bold font-sans flex items-center gap-2 text-destructive">
                                <ShieldBan className="w-5 h-5" />
                                {adminAction === 'suspend' ? 'Suspend User Account' : adminAction === 'ban' ? 'Ban User Account' : 'Lift Suspension'}
                            </DialogTitle>
                            <DialogDescription className="text-xs text-muted-foreground pt-1">
                                {adminAction === 'unsuspend'
                                    ? `Reactivate ${profileUser?.name}'s account and allow login/transactions.`
                                    : `Prevent ${profileUser?.name} from logging in or making transactions.`}
                            </DialogDescription>
                        </DialogHeader>

                        {adminAction !== 'unsuspend' && (
                            <div className="space-y-2 py-2">
                                <label className="text-xs font-semibold text-muted-foreground">Reason for {adminAction}</label>
                                <textarea
                                    value={adminReason}
                                    onChange={(e) => setAdminReason(e.target.value)}
                                    placeholder="e.g. Terms violation, fraudulent transactions, spam..."
                                    className="w-full h-20 p-2.5 rounded-xl bg-muted border border-border text-xs focus:outline-none"
                                />
                            </div>
                        )}

                        <div className="flex justify-end gap-2 pt-3">
                            <Button variant="ghost" size="sm" onClick={() => setAdminModalOpen(false)} disabled={adminLoading}>
                                Cancel
                            </Button>
                            <Button
                                variant={adminAction === 'unsuspend' ? 'default' : 'destructive'}
                                size="sm"
                                onClick={handleAdminSuspendAction}
                                disabled={adminLoading}
                                className="font-bold"
                            >
                                {adminLoading ? 'Processing...' : adminAction === 'unsuspend' ? 'Reactivate Account' : `Confirm ${adminAction.toUpperCase()}`}
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    );
}
