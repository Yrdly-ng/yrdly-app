"use client";

import type { Post as PostType } from "@/types";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, LinkIcon, MoreHorizontal, Edit, Trash2 } from "lucide-react";
import Image from "next/image";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-supabase-auth";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { timeAgo } from "@/lib/utils";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogTrigger,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreateEventDialog } from "./CreateEventDialog";
import { useToast } from "@/hooks/use-toast";
import { sendEventConfirmationEmail } from "@/lib/email-actions";
import { EventDetail } from "./events/EventDetail";

interface EventCardProps {
  event: PostType;
}

export function EventCard({ event }: EventCardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [attendeeCount, setAttendeeCount] = useState(event.attendees?.length || 0);
  const [isAttending, setIsAttending] = useState(event.attendees?.includes(user?.id || '') || false);
  const [loadingAttending, setLoadingAttending] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!event.id) return;
    
    // Keep track of who's coming to this event in real-time
    const channel = supabase
      .channel(`event_${event.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'posts',
        filter: `id=eq.${event.id}`
      }, (payload) => {
        const data = payload.new;
        const currentAttendees = data.attendees || [];
        setAttendeeCount(currentAttendees.length);
        if (user) {
          setIsAttending(currentAttendees.includes(user.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [event.id, user]);

  const handleAttendingToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      router.push('/login');
      return;
    }

    setLoadingAttending(true);

    try {
      // Fetch current attendees from database to avoid race conditions
      const { data: eventData, error: fetchError } = await supabase
        .from('posts')
        .select('attendees')
        .eq('id', event.id)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      const currentAttendees = eventData.attendees || [];
      const userHasRSVPed = currentAttendees.includes(user.id);

      let newAttendees;
      if (userHasRSVPed) {
        // Remove user from attendees array
        newAttendees = currentAttendees.filter((id: string) => id !== user.id);
      } else {
        // Add user to attendees array
        newAttendees = [...currentAttendees, user.id];
      }

      const { error } = await supabase
        .from('posts')
        .update({ attendees: newAttendees })
        .eq('id', event.id);
        
      if (error) throw error;
        
      // Send them a nice confirmation email if user just RSVP'd (not cancelled)
      if (!userHasRSVPed && user.email) {
        const emailResult = await sendEventConfirmationEmail({
          attendeeEmail: user.email,
          attendeeName: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
          eventName: event.title || 'Event',
          eventDate: event.event_date,
          eventTime: event.event_time,
          eventLocation: event.event_location?.address,
          eventDescription: event.text,
          eventLink: event.event_link || `${window.location.origin}/posts/${event.id}`,
        });

        if (emailResult.success) {
          toast({
            title: "Event confirmation sent!",
            description: "Check your email for event details.",
          });
        } else {
          console.error('Failed to send event confirmation email:', emailResult.error);
          toast({
            title: "Interest confirmed",
            description: "You're now interested in this event!",
            variant: "default",
          });
        }
      } else {
        toast({
          title: "Interest confirmed",
          description: "You're now interested in this event!",
        });
      }
    } catch (error) {
      console.error("Error updating attendance:", error);
      toast({
        title: "Error",
        description: "Failed to update attendance. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingAttending(false);
    }
  };

  const handleDelete = async () => {
    if (!user || !event.id || user.id !== event.user_id) return;
    try {
        const { error } = await supabase
            .from('posts')
            .delete()
            .eq('id', event.id);
        
        if (error) throw error;
        toast({ title: "Event deleted", description: "Your event has been successfully removed." });
        router.push('/events'); // Navigate back to events list after deletion
    } catch (error) {
        console.error("Error deleting event:", error);
        toast({ variant: "destructive", title: "Error", description: "Failed to delete event." });
    }
  }

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't open details if they clicked a button or link
    if ((e.target as HTMLElement).closest('a, button, [role="menu"]')) {
      return;
    }
    setIsDetailOpen(true);
  };

  return (
    <>
    <Card className="flex flex-col">
      <div onClick={handleCardClick} className="cursor-pointer">
        <div className="relative w-full overflow-hidden rounded-t-lg" style={{ aspectRatio: '16/9' }}>
          <Image
            src={event.image_url || event.image_urls?.[0] || '/placeholder-event.svg'}
            alt={event.title || event.text} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover"
            data-ai-hint="event image"
          />
          {event.image_urls && event.image_urls.length > 1 && (
            <div className="absolute top-2 right-2 bg-black/50 text-foreground px-2 py-1 rounded text-xs">
              +{event.image_urls.length - 1}
            </div>
          )}
        </div>
        <CardHeader>
           <div className="flex items-center space-x-3 mb-4">
               <Avatar>
                   <AvatarImage src={event.author_image} alt={event.author_name} data-ai-hint="person portrait"/>
                   <AvatarFallback>{event.author_name?.charAt(0) || 'U'}</AvatarFallback>
               </Avatar>
               <div className="flex-1">
                  <p className="text-sm font-semibold">{event.author_name || 'Anonymous User'}</p>
                  <p className="text-xs text-muted-foreground">{timeAgo(event.timestamp ? new Date(event.timestamp) : null)}</p>
               </div>
                {user?.id === event.user_id && (
                 <AlertDialog>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="ml-auto">
                                <MoreHorizontal className="h-5 w-5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={(e) => {
                                e.preventDefault();
                                setIsEditOpen(true);
                            }}>
                                <Edit className="mr-2 h-4 w-4" />
                                <span>Edit Event</span>
                            </DropdownMenuItem>
                             <AlertDialogTrigger asChild>
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    <span>Delete Event</span>
                                </DropdownMenuItem>
                            </AlertDialogTrigger>
                        </DropdownMenuContent>
                    </DropdownMenu>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete your event.
                        </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
               )}
           </div>
          <h3 className="text-xl font-semibold">{event.title}</h3>
          <p className="text-sm text-muted-foreground pt-1">{event.text}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {event.event_location && (
            <div className="flex items-center text-muted-foreground text-sm">
              <MapPin className="mr-2 h-4 w-4" /> {event.event_location.address}
            </div>
          )}
          {(event.event_date || event.event_time) && (
              <div className="flex items-center text-muted-foreground text-sm">
                  <Calendar className="mr-2 h-4 w-4" />
                  {event.event_date} {event.event_date && event.event_time ? 'at' : ''} {event.event_time}
              </div>
          )}
          {event.event_link && (
            <div className="flex items-center text-sm">
              <LinkIcon className="mr-2 h-4 w-4 text-muted-foreground" />
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  window.open(event.event_link, '_blank', 'noopener,noreferrer');
                }}
                className="text-blue-600 hover:underline truncate text-left bg-transparent border-none p-0 cursor-pointer"
              >
                {event.event_link}
              </button>
            </div>
          )}
        </CardContent>
      </div>
      <CardFooter className="flex justify-between items-center mt-auto">
        <Button
          variant={isAttending ? "secondary" : "default"}
          onClick={handleAttendingToggle}
          disabled={loadingAttending || !user}
        >
          {loadingAttending ? "Processing..." : isAttending ? "I'm interested" : "I'm interested"}
        </Button>
        
        <div className="flex flex-col items-end space-y-1">
          <span className="text-sm text-muted-foreground">{attendeeCount} {attendeeCount === 1 ? 'interested' : 'interested'}</span>
          
          {user?.email && (
            <p className="text-xs text-muted-foreground text-center">
              Event confirmations will be sent to your registered email
            </p>
          )}
        </div>
      </CardFooter>
    </Card>

    <EventDetail
      event={event}
      isOpen={isDetailOpen}
      onClose={() => setIsDetailOpen(false)}
      onEditEvent={(event) => {
        setIsDetailOpen(false);
        setIsEditOpen(true);
      }}
      onDeleteEvent={handleDelete}
    />

    <CreateEventDialog 
      postToEdit={event}
      onOpenChange={setIsEditOpen}
    />
    </>
  );
}