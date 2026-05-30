
"use client";

import { useEffect, useState, useRef as reactUseRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-supabase-auth';
import { NotificationTriggers } from '@/lib/notification-triggers';
import type { User } from '@/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';
import { MapPin, MessageSquare, UserPlus, Check, X, Clock, MoreHorizontal, ShieldBan, UserMinus } from 'lucide-react';
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

interface UserProfileDialogProps {
    user: User;
    open: boolean;
    onOpenChange: (wasChanged: boolean) => void;
}

export function UserProfileDialog({ user: profileUser, open, onOpenChange }: UserProfileDialogProps) {
    const { user: currentUser } = useAuth();
    const { toast } = useToast();
    const router = useRouter();
    const isDesktop = useMediaQuery("(min-width: 768px)");
    
    // Ensure we only trigger the notification once per open session
    const hasTriggeredViewRef = reactUseRef<boolean>(false);

    // ── Single source of truth for friendship state ──
    const friendship = useFriendshipGlobal(profileUser?.id);
    const { status: friendshipStatus, isLoading: friendshipLoading } = friendship;

    // ── Block state ──
    const [isBlocked, setIsBlocked] = useState(false);

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
                            <Clock className="mr-2 h-4 w-4" /> Request Sent
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
                                            <Button variant="ghost" size="icon"><MoreHorizontal className="h-5 w-5" /></Button>
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
                        <h1 className="text-2xl font-bold">{profileUser.name}</h1>
                        {profileUser.location && (
                            <div className="flex items-center text-sm text-muted-foreground mt-1">
                                <MapPin className="h-4 w-4 mr-1" />
                                <span>{displayLocation(profileUser.location)}</span>
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="p-6 space-y-6">
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
                    </CardContent>
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
    );
}
