"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageCircle, User as UserIcon, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import type { User } from "@/types";

interface FriendsListProps {
  userId: string;
  onBack: () => void;
}

export function FriendsList({ userId, onBack }: FriendsListProps) {
  const router = useRouter();
  const { user: currentUser } = useAuth();
  const [friends, setFriends] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFriends = async () => {
      try {
        setLoading(true);
        
        // Get user's friends list
        const { data: userData, error: userError } = await supabase
          .from('users')
          .select('friends')
          .eq('id', userId)
          .single();

        if (userError) throw userError;

        const friendIds = userData?.friends || [];
        
        if (friendIds.length === 0) {
          setFriends([]);
          setLoading(false);
          return;
        }

        // Fetch friend details
        const { data: friendsData, error: friendsError } = await supabase
          .from('users')
          .select('id, name, email, avatar_url, created_at')
          .in('id', friendIds);

        if (friendsError) throw friendsError;

        // Map the data to match the User type
        const mappedFriends = (friendsData || []).map(friend => ({
          ...friend,
          uid: friend.id, // Add uid property
          avatar_url: friend.avatar_url,
          timestamp: friend.created_at, // Map created_at to timestamp
        }));

        setFriends(mappedFriends);
      } catch (error) {
        console.error('Error fetching friends:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchFriends();
  }, [userId]);

  const handleMessageFriend = async (friendId: string) => {
    if (!currentUser) return;

    try {
      // Check if conversation already exists
      const { data: existingConversations, error: fetchError } = await supabase
        .from('conversations')
        .select('id, participant_ids')
        .contains('participant_ids', [currentUser.id])
        .contains('participant_ids', [friendId])
        .eq('type', 'friend');

      if (fetchError) {
        console.error("Error fetching conversations:", fetchError);
        return;
      }
      
      let conversationId: string;

      if (!existingConversations || existingConversations.length === 0) {
        // Create new friend conversation
        const sortedParticipantIds = [currentUser.id, friendId].sort();
        const { data: newConv, error: createError } = await supabase
          .from('conversations')
          .insert({
            participant_ids: sortedParticipantIds,
            type: 'friend',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        
        if (createError) throw createError;
        conversationId = newConv.id;
      } else {
        conversationId = existingConversations[0].id;
      }
      
      // Navigate to the conversation
      router.push(`/messages/${conversationId}`);
    } catch (error) {
      console.error("Error creating conversation:", error);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="p-2"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h2 className="text-xl font-semibold">Friends</h2>
      </div>

      {/* Friends List */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-12 h-12 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="w-20 h-8" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : friends.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="inline-block bg-muted p-4 rounded-full mb-4">
              <UserIcon className="h-12 w-12 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No Friends Yet</h3>
            <p className="text-sm text-muted-foreground">
              Start connecting with people in your neighborhood!
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {friends.map((friend) => (
            <Card key={friend.id} className="hover:bg-muted/50 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Avatar 
                    className="w-12 h-12 cursor-pointer"
                    onClick={() => router.push(`/profile/${friend.id}`)}
                  >
                    <AvatarImage src={friend.avatar_url || "/placeholder.svg"} />
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {friend.name?.substring(0, 2).toUpperCase() || "U"}
                    </AvatarFallback>
                  </Avatar>
                  
                  <div className="flex-1 min-w-0">
                    <h3 
                      className="font-semibold text-foreground truncate cursor-pointer hover:underline"
                      onClick={() => router.push(`/profile/${friend.id}`)}
                    >
                      {friend.name || "Unknown User"}
                    </h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {friend.email}
                    </p>
                    <p className="text-xs text-muted-foreground">       
                      Member since {new Date(friend.timestamp || '').getFullYear()}
                    </p>
                  </div>
                  
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleMessageFriend(friend.id)}
                  >
                    <MessageCircle className="w-4 h-4 mr-2" />
                    Message
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
