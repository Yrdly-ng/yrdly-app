-- Migration: Migrate legacy mobile events (from posts table) into the events table
-- This script ensures all events are unified into the modern events system.

DO $$ 
DECLARE
  post_record RECORD;
  new_event_id UUID;
  default_price NUMERIC;
BEGIN
  FOR post_record IN 
    SELECT * FROM public.posts 
    WHERE category = 'Event' AND event_link IS NULL
  LOOP
    -- 1. Insert into events table
    INSERT INTO public.events (
      id, -- We'll keep the same ID for consistency or generate a new one. Since posts and events use UUID, let's keep it.
      organizer_id,
      title,
      description,
      category,
      cover_image_url,
      location_address,
      location_online,
      ward,
      lga,
      state,
      start_time,
      timezone,
      status,
      visibility,
      payout_mode,
      created_at,
      updated_at
    ) VALUES (
      post_record.id,
      post_record.user_id,
      COALESCE(post_record.title, post_record.text, 'Untitled Event'),
      post_record.text,
      'Event',
      post_record.image_url, -- Note: legacy posts might use image_url or image_urls. We'll use image_url.
      COALESCE(post_record.ward || ', ' || post_record.lga || ', ' || post_record.state, ''),
      false,
      post_record.ward,
      post_record.lga,
      post_record.state,
      COALESCE(post_record.timestamp, now()),
      'Africa/Lagos',
      'PUBLISHED',
      'PUBLIC',
      'INSTANT',
      COALESCE(post_record.created_at, post_record.timestamp, now()),
      COALESCE(post_record.updated_at, post_record.timestamp, now())
    ) RETURNING id INTO new_event_id;

    -- 2. Create the default ticket tier
    default_price := COALESCE(post_record.price, 0);
    
    INSERT INTO public.ticket_tiers (
      event_id,
      name,
      description,
      price,
      capacity,
      sold,
      is_visible,
      created_at,
      updated_at
    ) VALUES (
      new_event_id,
      CASE WHEN default_price > 0 THEN 'General Admission' ELSE 'Free RSVP' END,
      'Legacy migrated event tier.',
      default_price,
      NULL, -- Unlimited capacity
      0,
      true,
      now(),
      now()
    );

    -- 3. Update the post to point to the new event
    UPDATE public.posts 
    SET event_link = 'yrdly://events/' || new_event_id::text
    WHERE id = post_record.id;

  END LOOP;
END $$;
