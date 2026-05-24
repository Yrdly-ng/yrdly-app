"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-supabase-auth';
import { MapPin, User, Calendar, X, ChevronLeft, ChevronRight, Clock, Link as LinkIcon } from 'lucide-react';
import { Post } from '@/types';
import { timeAgo } from '@/lib/utils';
import { CreateEventDialog } from '../CreateEventDialog';
import { useToast } from '@/hooks/use-toast';
import { sendEventConfirmationEmail } from '@/lib/email-actions';
import { supabase } from '@/lib/supabase';

interface EventDetailProps {
  event: Post;
  isOpen: boolean;
  onClose: () => void;
  onEditEvent?: (event: Post) => void;
  onDeleteEvent?: (eventId: string) => void;
}

export function EventDetail({ 
  event, 
  isOpen, 
  onClose, 
  onEditEvent, 
  onDeleteEvent 
}: EventDetailProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAttending, setIsAttending] = useState(false);
  const [attendeeCount, setAttendeeCount] = useState(event.attendees?.length || 0);
  const [loadingAttending, setLoadingAttending] = useState(false);

  const isOwner = user?.id === event.user_id;
  const hasImages = (event.image_urls && event.image_urls.length > 0) || event.image_url;
  const images = hasImages ? (event.image_urls || [event.image_url].filter(Boolean)) : ['/placeholder-event.svg'];

  const handleDelete = async () => {
    if (!onDeleteEvent) return;
    
    setIsDeleting(true);
    try {
      await onDeleteEvent(event.id);
      setIsDeleteDialogOpen(false);
      onClose();
    } catch (error) {
      console.error('Failed to delete event:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAttendingToggle = async () => {
    if (!user) return;
    
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
      const userIsAttending = currentAttendees.includes(user.id);
      
      let newAttendees;
      if (userIsAttending) {
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
      
      setIsAttending(!userIsAttending);
      setAttendeeCount(newAttendees.length);

      // Send confirmation email if user just RSVP'd (not cancelled)
      if (!userIsAttending && user.email) {
        try {
          await sendEventConfirmationEmail({
            attendeeEmail: user.email,
            attendeeName: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
            eventName: event.title || 'Event',
            eventDate: event.event_date,
            eventTime: event.event_time,
            eventLocation: event.event_location?.address,
            eventDescription: event.text,
            eventLink: event.event_link || `${window.location.origin}/posts/${event.id}`,
          });

          toast({
            title: "Event confirmation sent!",
            description: "Check your email for event details.",
          });
        } catch (emailError) {
          console.error('Failed to send confirmation email:', emailError);
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

  const nextImage = () => {
    if (!images || images.length === 0) return;
    setCurrentImageIndex((prev) => (prev + 1) % images.length);
  };

  const prevImage = () => {
    if (!images || images.length === 0) return;
    setCurrentImageIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatTime = (timeString: string) => {
    const [hours, minutes] = timeString.split(':');
    const date = new Date();
    date.setHours(parseInt(hours), parseInt(minutes));
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" hideClose>
          <DialogHeader className="flex flex-row items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold">
                {event.title || event.text}
              </DialogTitle>
              <DialogDescription>
                View event details and join this event
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>

          <div className="space-y-6">
            {/* Image Gallery */}
            {hasImages && (
              <div className="relative">
                <div className="relative aspect-video w-full max-w-2xl mx-auto rounded-lg overflow-hidden">
                  <Image
                    src={images?.[currentImageIndex] || ''}
                    alt={event.title || 'Event image'}
                    fill
                    className="object-cover"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                  
                  {/* Navigation arrows for multiple images */}
                  {images && images.length > 1 && (
                    <>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-white/90 hover:bg-white"
                        onClick={prevImage}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="icon"
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-white/90 hover:bg-white"
                        onClick={nextImage}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </>
                  )}

                  {/* Image counter */}
                  {images && images.length > 1 && (
                    <div className="absolute bottom-2 right-2 bg-black/50 text-foreground px-2 py-1 rounded text-sm">
                      {currentImageIndex + 1} / {images.length}
                    </div>
                  )}
                </div>

                {/* Thumbnail strip */}
                {images && images.length > 1 && (
                  <div className="flex gap-2 mt-4 overflow-x-auto">
                    {images.map((image, index) => (
                      <button
                        key={index}
                        onClick={() => setCurrentImageIndex(index)}
                        className={`relative w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 ${
                          index === currentImageIndex ? 'ring-2 ring-primary' : ''
                        }`}
                      >
                        <Image
                          src={image || '/placeholder-event.svg'}
                          alt={`Thumbnail ${index + 1}`} fill sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                          className="object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Event Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column - Event Info */}
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Event Details</h3>
                      {isOwner && (
                        <div className="text-sm text-muted-foreground">
                          <p>This is your event. Use the 3 dots menu on the event card to edit or delete.</p>
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Date & Time */}
                    {event.event_date && (
                      <div className="flex items-center space-x-3">
                        <Calendar className="w-5 h-5 text-primary" />
                        <div>
                          <p className="font-medium">{formatDate(event.event_date)}</p>
                          {event.event_time && (
                            <p className="text-sm text-muted-foreground flex items-center">
                              <Clock className="w-4 h-4 mr-1" />
                              {formatTime(event.event_time)}
                            </p>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Location */}
                    {event.event_location && (
                      <div className="flex items-start space-x-3">
                        <MapPin className="w-5 h-5 text-primary mt-0.5" />
                        <div>
                          <p className="font-medium">Location</p>
                          <p className="text-sm text-muted-foreground">{event.event_location.address}</p>
                        </div>
                      </div>
                    )}

                    {/* Event Link */}
                    {event.event_link && (
                      <div className="flex items-center space-x-3">
                        <LinkIcon className="w-5 h-5 text-primary" />
                        <div>
                          <p className="font-medium">Event Link</p>
                          <a 
                            href={event.event_link} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline"
                          >
                            {event.event_link}
                          </a>
                        </div>
                      </div>
                    )}

                    {/* Description */}
                    {event.text && (
                      <div>
                        <h4 className="font-medium mb-2">Description</h4>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {event.text}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Organizer Info */}
                <Card>
                  <CardHeader>
                    <h3 className="text-lg font-semibold">Event Organizer</h3>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center">
                        {event.author_image ? (
                          <Image
                            src={event.author_image}
                            alt={event.author_name || 'Organizer'}
                            width={48}
                            height={48}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="w-6 h-6 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium">{event.author_name || 'Unknown Organizer'}</p>
                        <p className="text-sm text-muted-foreground">Event Organizer</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span>Created {timeAgo(new Date(event.timestamp))}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Right Column - Actions & Attendance */}
              <div className="space-y-4">
                {/* Attendance Section */}
                <Card>
                  <CardHeader>
                    <h3 className="text-lg font-semibold">Attendance</h3>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-primary">{attendeeCount}</p>
                      <p className="text-sm text-muted-foreground">
                        {attendeeCount === 1 ? 'person interested' : 'people interested'}
                      </p>
                    </div>

                    {!isOwner && (
                      <Button 
                        onClick={handleAttendingToggle}
                        disabled={loadingAttending}
                        className="w-full"
                        variant={isAttending ? "outline" : "default"}
                      >
                        {loadingAttending ? 'Updating...' : 
                         isAttending ? 'I\'m interested' : 'I\'m interested'}
                      </Button>
                    )}

                    {isOwner && (
                      <div className="text-center text-muted-foreground">
                        <p className="text-sm">This is your event.</p>
                        <p className="text-xs">Use the edit/delete buttons above to manage it.</p>
                      </div>
                    )}

                    {user?.email && (
                      <p className="text-xs text-muted-foreground text-center">
                        Event confirmations will be sent to your registered email
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Event</DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <p className="text-muted-foreground">
              Are you sure you want to delete &quot;{event.title || event.text}&quot;? This action cannot be undone.
            </p>
            
            <div className="flex justify-end space-x-2">
              <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                variant="destructive" 
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

