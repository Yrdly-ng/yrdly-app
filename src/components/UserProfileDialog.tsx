
"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-supabase-auth';
import type { User, FriendRequest } from '@/types';
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

type FriendshipStatus = 'friends' | 'request_sent' | 'request_received' | 'none';

interface UserProfileDialogProps {
    user: User;
    open: boolean;
    onOpenChange: (wasChanged: boolean) => void;
}

export function UserProfileDialog({ user: profileUser, open, onOpenChange }: UserProfileDialogProps) {
    const { user: currentUser, profile: userDetails } = useAuth();
    const { toast } = useToast();
    const router = useRouter();
    const isDesktop = useMediaQuery("(min-width: 768px)");

    const [friendshipStatus, setFriendshipStatus] = useState<FriendshipStatus>('none');
    const [friendRequest, setFriendRequest] = useState<FriendRequest | null>(null);
    const [isBlocked, setIsBlocked] = useState(false);

    useEffect(() => {
        const checkFriendshipStatus = async () => {
            if (!profileUser || !currentUser || !userDetails) {
                if (open) onOpenChange(false);
                return;
            };

            // Don't open a dialog for the current user
            if (profileUser.id === currentUser.id) {
                if (open) onOpenChange(false);
                return;
            }
            
            setIsBlocked(userDetails.blocked_users?.includes(profileUser.id) ?? false);

            if (userDetails.friends?.includes(profileUser.id)) {
                setFriendshipStatus('friends');
            } else {
                // Only check for requests if they are not friends
                const { data: requestsData, error } = await supabase
                    .from('friend_requests')
                    .select('*')
                    .or(`from_user_id.eq.${currentUser.id},to_user_id.eq.${currentUser.id}`)
                    .or(`from_user_id.eq.${profileUser.id},to_user_id.eq.${profileUser.id}`)
                    .eq('status', 'pending');
                
                if (!error && requestsData && requestsData.length > 0) {
                    const request = requestsData[0] as FriendRequest;
                    setFriendRequest(request);
                    setFriendshipStatus(request.from_user_id === currentUser.id ? 'request_sent' : 'request_received');
                } else {
                    setFriendRequest(null);
                    setFriendshipStatus('none');
                }
            }
        };

        checkFriendshipStatus();
    }, [profileUser, currentUser, userDetails, open, onOpenChange]);
    
    // Listen for profile refresh events (e.g., after accepting friend request from another component)
    useEffect(() => {
        if (!open) return;
        
        const handleRefresh = () => {
            if (profileUser && currentUser && userDetails) {
                // Re-check friendship status when profile is refreshed
                const recheckFriendship = async () => {
                    setIsBlocked(userDetails.blocked_users?.includes(profileUser.id) ?? false);

                    if (userDetails.friends?.includes(profileUser.id)) {
                        setFriendshipStatus('friends');
                    } else {
                        const { data: requestsData, error } = await supabase
                            .from('friend_requests')
                            .select('*')
                            .or(`from_user_id.eq.${currentUser.id},to_user_id.eq.${currentUser.id}`)
                            .or(`from_user_id.eq.${profileUser.id},to_user_id.eq.${profileUser.id}`)
                            .eq('status', 'pending');
                        
                        if (!error && requestsData && requestsData.length > 0) {
                            const request = requestsData[0] as FriendRequest;
                            setFriendRequest(request);
                            setFriendshipStatus(request.from_user_id === currentUser.id ? 'request_sent' : 'request_received');
                        } else {
                            setFriendRequest(null);
                            setFriendshipStatus('none');
                        }
                    }
                };
                recheckFriendship();
            }
        };
        
        window.addEventListener('refresh-profile', handleRefresh);
        return () => window.removeEventListener('refresh-profile', handleRefresh);
    }, [open, profileUser, currentUser, userDetails]);


    const handleAddFriend = async () => {
        if (!currentUser || !profileUser || isBlocked) return;
        try {
            // Create friend request
            const { error: requestError } = await supabase
                .from('friend_requests')
                .insert({
                    from_user_id: currentUser.id,
                    to_user_id: profileUser.id,
                    participant_ids: [currentUser.id, profileUser.id].sort(),
                    status: 'pending',
                    timestamp: new Date().toISOString()
                });
            
            if (requestError) throw requestError;

            // Create notification for the recipient
            const { error: notificationError } = await supabase
                .from('notifications')
                .insert({
                    user_id: profileUser.id,
                    type: 'friend_request',
                    title: 'New Friend Request',
                    message: `${currentUser.user_metadata?.name || currentUser.email?.split('@')[0] || 'Someone'} wants to be your friend`,
                    data: {
                        from_user_id: currentUser.id,
                        from_user_name: currentUser.user_metadata?.name || currentUser.email?.split('@')[0] || 'Unknown',
                        request_id: '', // We'll need to get this from the friend request
                    },
                    created_at: new Date().toISOString(),
                });

            if (notificationError) {
                console.error("Error creating notification:", notificationError);
                // Don't fail the friend request if notification fails
            }

            toast({ title: "Friend request sent!" });
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Could not send friend request." });
        }
    };

    const handleAcceptRequest = async () => {
        if (!currentUser || !friendRequest) return;
        try {
            // Update friend request status
            const { error: updateError } = await supabase
                .from('friend_requests')
                .update({ status: 'accepted' })
                .eq('id', friendRequest.id);
            
            if (updateError) throw updateError;
            
            // Add to friends list for both users
            // First get current friends list for current user
            const { data: currentUserData, error: fetchError1 } = await supabase
                .from('users')
                .select('friends')
                .eq('id', currentUser.id)
                .single();
            
            if (fetchError1) throw fetchError1;
            
            const { error: addFriendError } = await supabase
                .from('users')
                .update({ friends: [...(currentUserData.friends || []), friendRequest.from_user_id] })
                .eq('id', currentUser.id);
            
            if (addFriendError) throw addFriendError;
            
            // Then get current friends list for the other user
            const { data: otherUserData, error: fetchError2 } = await supabase
                .from('users')
                .select('friends')
                .eq('id', friendRequest.from_user_id)
                .single();
            
            if (fetchError2) throw fetchError2;
            
            const { error: addFriendError2 } = await supabase
                .from('users')
                .update({ friends: [...(otherUserData.friends || []), currentUser.id] })
                .eq('id', friendRequest.from_user_id);
            
            if (addFriendError2) throw addFriendError2;
            
            // Refresh friendship status and current user profile
            setFriendshipStatus('friends');
            
            // Refresh current user's profile data to update friends list
            if (currentUser) {
              try {
                const { data: refreshedProfile } = await supabase
                  .from('users')
                  .select('friends')
                  .eq('id', currentUser.id)
                  .single();
                
                if (refreshedProfile) {
                  // Update the profile in the auth context by triggering a refresh
                  // The real-time subscription should handle this, but we'll also manually refresh
                  window.dispatchEvent(new CustomEvent('refresh-profile'));
                }
              } catch (error) {
                console.error('Error refreshing profile after accepting friend request:', error);
              }
            }
            
            toast({ title: "Friend request accepted!" });
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Could not accept friend request." });
        }
    };

    const handleDeclineRequest = async () => {
        if (!friendRequest) return;
        try {
            const { error } = await supabase
                .from('friend_requests')
                .update({ status: 'declined' })
                .eq('id', friendRequest.id);
            
            if (error) throw error;
            toast({ title: "Friend request declined." });
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Could not decline friend request." });
        }
    };

    const handleUnfriend = async () => {
        if (!currentUser || !profileUser) return;
        try {
            // Remove from friends list for both users
            // First get current friends list for current user
            const { data: currentUserData, error: fetchError1 } = await supabase
                .from('users')
                .select('friends')
                .eq('id', currentUser.id)
                .single();
            
            if (fetchError1) throw fetchError1;
            
            const { error: removeFriendError } = await supabase
                .from('users')
                .update({ friends: (currentUserData.friends || []).filter((id: string) => id !== profileUser.id) })
                .eq('id', currentUser.id);
            
            if (removeFriendError) throw removeFriendError;
            
            // Then get current friends list for the other user
            const { data: otherUserData, error: fetchError2 } = await supabase
                .from('users')
                .select('friends')
                .eq('id', profileUser.id)
                .single();
            
            if (fetchError2) throw fetchError2;
            
            const { error: removeFriendError2 } = await supabase
                .from('users')
                .update({ friends: (otherUserData.friends || []).filter((id: string) => id !== currentUser.id) })
                .eq('id', profileUser.id);
            
            if (removeFriendError2) throw removeFriendError2;
            
            toast({ title: "Friend removed." });
            onOpenChange(true);
        } catch (error) {
            toast({ variant: "destructive", title: "Error", description: "Could not remove friend." });
        }
    };

    const handleBlockUser = async () => {
        if (!currentUser || !profileUser) return;
        try {
            // Get current blocked users list
            const { data: userData, error: fetchError } = await supabase
                .from('users')
                .select('blocked_users')
                .eq('id', currentUser.id)
                .single();
            
            if (fetchError) throw fetchError;
            
            const { error } = await supabase
                .from('users')
                .update({ blocked_users: [...(userData.blocked_users || []), profileUser.id] })
                .eq('id', currentUser.id);
            
            if (error) throw error;
            toast({ title: "User blocked." });
            onOpenChange(true); // Signal that a change was made
        } catch (error) {
            toast({ variant: "destructive", title: "Error", description: "Could not block user." });
        }
    };
    
    const handleUnblockUser = async () => {
        if (!currentUser || !profileUser) return;
        try {
            // Get current blocked users list
            const { data: userData, error: fetchError } = await supabase
                .from('users')
                .select('blocked_users')
                .eq('id', currentUser.id)
                .single();
            
            if (fetchError) throw fetchError;
            
            const { error } = await supabase
                .from('users')
                .update({ blocked_users: (userData.blocked_users || []).filter((id: string) => id !== profileUser.id) })
                .eq('id', currentUser.id);
            
            if (error) throw error;
            toast({ title: "User unblocked." });
            onOpenChange(true); // Signal that a change was made
        } catch {
            toast({ variant: "destructive", title: "Error", description: "Could not unblock user." });
        }
    };

    const displayLocation = (location?: User['location']) => {
        if (!location) return "Location not set";
        return [location.city, location.lga, location.state].filter(Boolean).join(", ");
    };

    const handleMessageClick = async () => {
        if (!currentUser || !profileUser) return;
        
        const sortedParticipantIds = [currentUser.id, profileUser.id].sort();
        
        try {
            // Check if conversation already exists
            // Get all conversations for the current user and filter for the specific friend
            const { data: allConversations, error: fetchError } = await supabase
                .from('conversations')
                .select('id, participant_ids')
                .contains('participant_ids', [currentUser.id]);

            if (fetchError) {
                console.error("Error fetching conversations:", fetchError);
                toast({ variant: "destructive", title: "Error", description: "Could not open conversation." });
                return;
            }

            // Filter for conversation with the specific friend
            const existingConversations = allConversations?.filter(conv => 
                conv.participant_ids.includes(currentUser.id) && 
                conv.participant_ids.includes(profileUser.id) &&
                conv.participant_ids.length === 2
            );
            
            let conversationId: string;

            if (!existingConversations || existingConversations.length === 0) {
                // Create new conversation
                const { data: newConv, error: createError } = await supabase
                    .from('conversations')
                    .insert({
                        participant_ids: sortedParticipantIds,
                        created_at: new Date().toISOString(),
                    })
                    .select('id')
                    .single();
                
                if (createError) throw createError;
                conversationId = newConv.id;
            } else {
                conversationId = existingConversations[0].id;
            }
            
            onOpenChange(false);
            router.push(`/messages/${conversationId}`);
        } catch (error) {
            console.error("Error handling message click:", error);
            toast({ variant: "destructive", title: "Error", description: "Could not start a conversation." });
        }
    }

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
                            onClick={handleUnfriend}
                            className="flex-1 rounded-lg"
                        >
                            <UserMinus className="mr-2 h-4 w-4" /> Remove Friend
                        </Button>
                        <Button 
                            variant="outline"
                            onClick={handleMessageClick}
                            className="flex-1 rounded-lg"
                        >
                            <MessageSquare className="mr-2 h-4 w-4" /> Message
                        </Button>
                    </div>
                );
            case 'request_sent':
                return <Button disabled className="rounded-lg w-full"><Clock className="mr-2 h-4 w-4" /> Request Sent</Button>;
            case 'request_received':
                return (
                    <div className="flex gap-2 w-full">
                        <Button onClick={handleAcceptRequest} className="flex-1 rounded-lg"><Check className="mr-2 h-4 w-4" /> Accept Request</Button>
                        <Button variant="outline" onClick={handleDeclineRequest} className="flex-1 rounded-lg"><X className="mr-2 h-4 w-4" /> Decline</Button>
                    </div>
                );
            case 'none':
            default:
                return <Button onClick={handleAddFriend} className="rounded-lg w-full"><UserPlus className="mr-2 h-4 w-4" /> Add Friend</Button>;
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
                                            <AlertDialogAction onClick={isBlocked ? handleUnblockUser : (friendshipStatus === 'friends' ? handleUnfriend : handleBlockUser)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                {isBlocked ? "Unblock" : (friendshipStatus === 'friends' ? "Unfriend" : "Block")}
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        )}
                        <Avatar className="h-24 w-24 mb-4 border-2 border-background"><AvatarImage src={profileUser.avatar_url} alt={profileUser.name} /><AvatarFallback>{profileUser.name.charAt(0)}</AvatarFallback></Avatar>
                        <h1 className="text-2xl font-bold">{profileUser.name}</h1>
                        {profileUser.location && (<div className="flex items-center text-sm text-muted-foreground mt-1"><MapPin className="h-4 w-4 mr-1" /><span>{displayLocation(profileUser.location)}</span></div>)}
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
                                        <span 
                                            key={index}
                                            className="px-3 py-1 bg-primary/10 text-primary text-sm rounded-full border border-primary/20"
                                        >
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
    )
}
