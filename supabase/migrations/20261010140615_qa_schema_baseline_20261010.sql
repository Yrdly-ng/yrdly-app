-- QA-ONLY: exact historical schema snapshot recovered from Staging migration history; not for merging to main.
BEGIN;

DO $$ BEGIN IF (SELECT count(*) FROM auth.users) <> 0 OR (SELECT count(*) FROM pg_tables WHERE schemaname='public') <> 1 OR (SELECT count(*) FROM public.rate_limits) <> 0 THEN RAISE EXCEPTION 'Refusing baseline restore: target is not the verified empty QA branch'; END IF; END $$;

DROP TABLE public.rate_limits;

SET LOCAL search_path=public,extensions;

SET LOCAL check_function_bodies=false;

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon,authenticated;

CREATE TYPE public.account_type AS ENUM ('bank_account', 'mobile_money', 'digital_wallet');

CREATE TYPE public.booking_status AS ENUM ('requested', 'confirmed', 'completed', 'cancelled', 'late_cancelled', 'no_show');

CREATE TYPE public.business_mode AS ENUM ('product', 'service', 'both');

CREATE TYPE public.delivery_option AS ENUM ('face_to_face', 'partnered_service', 'own_logistics');

CREATE TYPE public.escrow_status AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'completed', 'disputed', 'cancelled', 'creating_escrow', 'reconciling');

CREATE TYPE public.onboarding_step AS ENUM ('signup', 'email_verification', 'profile_setup', 'welcome', 'tour', 'completed');

CREATE TYPE public.payment_method AS ENUM ('card', 'bank_transfer', 'mobile_money', 'wallet');

CREATE TYPE public.payment_status_enum AS ENUM ('unpaid', 'deposit_pending', 'deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released', 'refunded', 'failed');

CREATE TYPE public.payment_type_enum AS ENUM ('deposit', 'full', 'escrow');

CREATE TYPE public.post_category AS ENUM ('General', 'Event', 'For Sale', 'Business', 'Giveaway');

CREATE TYPE public.quote_status AS ENUM ('pending', 'estimated', 'accepted', 'rejected', 'expired', 'converted', 'cancelled');

CREATE TYPE public.strike_party_enum AS ENUM ('customer', 'provider');

CREATE TYPE public.strike_type_enum AS ENUM ('late_cancellation', 'no_show');

CREATE TYPE public.verification_level AS ENUM ('basic', 'bank_account', 'identity', 'address');

CREATE TYPE public.verification_status AS ENUM ('pending', 'verified', 'rejected', 'expired');

CREATE TABLE IF NOT EXISTS public.admin_sessions (id uuid DEFAULT gen_random_uuid() NOT NULL, session_token text NOT NULL, ip_address text NOT NULL, expires_at timestamp with time zone NOT NULL, created_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.alerts (id uuid DEFAULT gen_random_uuid() NOT NULL, type text NOT NULL, title text NOT NULL, description text NOT NULL, subject_name text, subject_age integer, subject_photo_url text, last_seen_address text, radius_km integer DEFAULT 50, contact_info text, source text DEFAULT 'yrdly_admin'::text, is_resolved boolean DEFAULT false, resolved_at timestamp with time zone, created_at timestamp with time zone DEFAULT now(), created_by uuid, expires_at timestamp with time zone);

CREATE TABLE IF NOT EXISTS public.availability_exceptions (id uuid DEFAULT gen_random_uuid() NOT NULL, business_id uuid NOT NULL, date date NOT NULL, is_blackout boolean DEFAULT true NOT NULL, custom_start_time time without time zone, custom_end_time time without time zone, reason text, created_at timestamp with time zone DEFAULT now() NOT NULL, staff_id uuid);

CREATE TABLE IF NOT EXISTS public.booking_payments (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid NOT NULL, amount numeric NOT NULL, type payment_type_enum NOT NULL, status payment_status_enum DEFAULT 'deposit_pending'::payment_status_enum NOT NULL, provider text DEFAULT 'payluk'::text NOT NULL, payluk_reference text, payluk_checkout_url text, escrow_hold boolean DEFAULT false NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, paid_at timestamp with time zone, payluk_escrow_id text, payluk_payment_token text);

CREATE TABLE IF NOT EXISTS public.bookings (id uuid DEFAULT gen_random_uuid() NOT NULL, customer_id uuid NOT NULL, business_id uuid NOT NULL, service_id uuid NOT NULL, appointment_time timestamp with time zone NOT NULL, end_time timestamp with time zone NOT NULL, status booking_status DEFAULT 'requested'::booking_status NOT NULL, notes text, cancelled_by uuid, cancelled_at timestamp with time zone, strike_type strike_type_enum, strike_party strike_party_enum, reminder_24h_sent boolean DEFAULT false NOT NULL, reminder_2h_sent boolean DEFAULT false NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, staff_id uuid, payment_status payment_status_enum DEFAULT 'unpaid'::payment_status_enum NOT NULL, payment_due_at timestamp with time zone, quote_id uuid);

CREATE TABLE IF NOT EXISTS public.business_favorites (id uuid DEFAULT gen_random_uuid() NOT NULL, business_id uuid NOT NULL, user_id uuid NOT NULL, created_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.business_messages (id uuid DEFAULT gen_random_uuid() NOT NULL, business_id uuid, sender_id uuid, content text NOT NULL, item_id uuid, is_read boolean DEFAULT false, created_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.business_reviews (id uuid DEFAULT gen_random_uuid() NOT NULL, business_id uuid, user_id uuid, rating integer, comment text, created_at timestamp with time zone DEFAULT now(), transaction_id uuid, verified_purchase boolean DEFAULT false, booking_id uuid);

CREATE TABLE IF NOT EXISTS public.business_staff (id uuid DEFAULT gen_random_uuid() NOT NULL, business_id uuid NOT NULL, user_id uuid, name text NOT NULL, role text, avatar_url text, is_active boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.businesses (id uuid DEFAULT uuid_generate_v4() NOT NULL, owner_id uuid NOT NULL, name character varying(255) NOT NULL, category character varying(100) NOT NULL, description text, location jsonb NOT NULL, image_urls text[] DEFAULT '{}'::text[], rating numeric(3,2) DEFAULT NULL::numeric, review_count integer DEFAULT 0, hours text, phone text, email text, website text, owner_name text, owner_avatar text, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), state text, lga text, ward text, admin_location jsonb, logo text, cover_image text, is_active boolean DEFAULT true NOT NULL, followers_count integer DEFAULT 0, view_count integer DEFAULT 0, logo_url text, lat double precision, lng double precision, moderation_status text DEFAULT 'approved'::text NOT NULL, location_geom geography(Point,4326), mode business_mode DEFAULT 'product'::business_mode NOT NULL, no_show_count integer DEFAULT 0 NOT NULL, late_cancellation_count integer DEFAULT 0 NOT NULL, is_flagged boolean DEFAULT false NOT NULL);

CREATE TABLE IF NOT EXISTS public.catalog_items (id uuid DEFAULT gen_random_uuid() NOT NULL, business_id uuid, title text NOT NULL, description text, price numeric(10,2) NOT NULL, images text[], category text, in_stock boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), transaction_id uuid, quantity integer DEFAULT 1, inventory_count integer DEFAULT 0, moderation_status text DEFAULT 'approved'::text NOT NULL);

CREATE TABLE IF NOT EXISTS public.chat_messages (id uuid DEFAULT uuid_generate_v4() NOT NULL, chat_id uuid, sender_id text NOT NULL, sender_name text NOT NULL, content text NOT NULL, message_type text DEFAULT 'text'::text NOT NULL, metadata jsonb DEFAULT '{}'::jsonb, "timestamp" timestamp with time zone DEFAULT now(), created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.comment_likes (comment_id uuid NOT NULL, user_id uuid NOT NULL, created_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.comment_reports (id uuid DEFAULT gen_random_uuid() NOT NULL, comment_id uuid NOT NULL, post_id uuid, reporter_id uuid NOT NULL, reason text NOT NULL, status text DEFAULT 'open'::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.comments (id uuid DEFAULT uuid_generate_v4() NOT NULL, user_id uuid, post_id uuid, author_name text NOT NULL, author_image text, text text NOT NULL, "timestamp" timestamp with time zone DEFAULT now(), parent_id uuid, reactions jsonb DEFAULT '{}'::jsonb, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), like_count integer DEFAULT 0);

CREATE TABLE IF NOT EXISTS public.communities (id uuid DEFAULT gen_random_uuid() NOT NULL, name text NOT NULL, slug text NOT NULL, description text, avatar_url text, banner_url text, type text NOT NULL, privacy text DEFAULT 'open'::text NOT NULL, state text, lga text, ward text, ward_id uuid, parent_community_id uuid, created_by uuid, is_official boolean DEFAULT false NOT NULL, rules jsonb DEFAULT '[]'::jsonb NOT NULL, post_daily_limit integer DEFAULT 5 NOT NULL, member_count integer DEFAULT 0 NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, approval_status text DEFAULT 'approved'::text NOT NULL, reviewed_by uuid, reviewed_at timestamp with time zone, rejection_reason text);

CREATE TABLE IF NOT EXISTS public.community_comment_likes (comment_id uuid NOT NULL, user_id uuid NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.community_comments (id uuid DEFAULT gen_random_uuid() NOT NULL, post_id uuid NOT NULL, community_id uuid NOT NULL, author_id uuid NOT NULL, author_name text, author_image text, parent_comment_id uuid, content text NOT NULL, like_count integer DEFAULT 0 NOT NULL, moderation_status text DEFAULT 'pending'::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.community_invites (id uuid DEFAULT gen_random_uuid() NOT NULL, community_id uuid NOT NULL, invited_user_id uuid NOT NULL, invited_by uuid NOT NULL, status text DEFAULT 'pending'::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, responded_at timestamp with time zone);

CREATE TABLE IF NOT EXISTS public.community_join_requests (id uuid DEFAULT gen_random_uuid() NOT NULL, community_id uuid NOT NULL, user_id uuid NOT NULL, message text, status text DEFAULT 'pending'::text NOT NULL, reviewed_by uuid, reviewed_at timestamp with time zone, created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.community_memberships (id uuid DEFAULT gen_random_uuid() NOT NULL, community_id uuid NOT NULL, user_id uuid NOT NULL, role text DEFAULT 'member'::text NOT NULL, status text DEFAULT 'active'::text NOT NULL, is_auto_joined boolean DEFAULT false NOT NULL, is_muted boolean DEFAULT false NOT NULL, muted_at timestamp with time zone, joined_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.community_post_likes (post_id uuid NOT NULL, user_id uuid NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.community_posts (id uuid DEFAULT gen_random_uuid() NOT NULL, community_id uuid NOT NULL, author_id uuid NOT NULL, author_name text, author_image text, content text NOT NULL, image_urls text[], video_urls text[], is_pinned boolean DEFAULT false NOT NULL, is_edited boolean DEFAULT false NOT NULL, like_count integer DEFAULT 0 NOT NULL, comment_count integer DEFAULT 0 NOT NULL, moderation_status text DEFAULT 'pending'::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.conversations (id uuid DEFAULT gen_random_uuid() NOT NULL, participant_ids uuid[] NOT NULL, last_message_id uuid, last_message_text text, last_message_sender_id uuid, last_message_timestamp timestamp with time zone, last_message_is_read boolean DEFAULT false, last_message_read_by text[] DEFAULT '{}'::text[], typing jsonb DEFAULT '{}'::jsonb, type text DEFAULT 'friend'::text, item_id uuid, item_title text, item_image text, item_price numeric(10,2), business_id uuid, business_name text, business_logo text, context jsonb, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), deleted_by text[] DEFAULT '{}'::text[], title text, avatar_url text, created_by uuid, admin_ids text[] DEFAULT '{}'::text[], invite_code text, is_invite_link_active boolean DEFAULT true NOT NULL);

CREATE TABLE IF NOT EXISTS public.dispute_resolution_operations (id uuid DEFAULT gen_random_uuid() NOT NULL, dispute_id uuid NOT NULL, requested_by uuid NOT NULL, resolution text NOT NULL, refund_amount numeric(12,2) NOT NULL, seller_amount numeric(12,2) NOT NULL, payment_provider text, status text DEFAULT 'processing'::text NOT NULL, provider_reference text, error_message text, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.disputes (id uuid DEFAULT uuid_generate_v4() NOT NULL, transaction_id uuid NOT NULL, opened_by uuid NOT NULL, dispute_reason text NOT NULL, buyer_evidence jsonb DEFAULT '{}'::jsonb, seller_evidence jsonb DEFAULT '{}'::jsonb, admin_notes text, resolution text, status text DEFAULT 'open'::text NOT NULL, resolved_by uuid, refund_amount numeric(10,2) DEFAULT 0, seller_amount numeric(10,2) DEFAULT 0, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), resolved_at timestamp with time zone, provider_submission_status text DEFAULT 'not_required'::text NOT NULL, provider_submission_error text, provider_seller_reply_status text DEFAULT 'not_required'::text NOT NULL, provider_seller_reply_error text);

CREATE TABLE IF NOT EXISTS public.escrow_transactions (id uuid DEFAULT uuid_generate_v4() NOT NULL, item_id text NOT NULL, buyer_id uuid, seller_id uuid, amount numeric(10,2) NOT NULL, commission numeric(10,2) NOT NULL, total_amount numeric(10,2) NOT NULL, seller_amount numeric(10,2) NOT NULL, status escrow_status DEFAULT 'pending'::escrow_status NOT NULL, payment_method payment_method NOT NULL, delivery_details jsonb NOT NULL, paid_at timestamp with time zone, shipped_at timestamp with time zone, delivered_at timestamp with time zone, completed_at timestamp with time zone, dispute_reason text, dispute_resolved_at timestamp with time zone, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), payment_reference text, payment_provider text DEFAULT 'payluk'::text, flutterwave_tx_ref text, item_type text DEFAULT 'post'::text NOT NULL, payluk_tx_ref text, payluk_escrow_id text, creating_escrow_started_at timestamp with time zone, metadata jsonb DEFAULT '{}'::jsonb);

CREATE TABLE IF NOT EXISTS public.event_bookmarks (id uuid DEFAULT gen_random_uuid() NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, user_id uuid NOT NULL, event_id uuid NOT NULL);

CREATE TABLE IF NOT EXISTS public.event_payouts (id uuid DEFAULT gen_random_uuid() NOT NULL, event_id uuid NOT NULL, organizer_id uuid NOT NULL, gross_amount numeric(12,2) DEFAULT 0 NOT NULL, commission_amount numeric(12,2) DEFAULT 0 NOT NULL, net_amount numeric(12,2) DEFAULT 0 NOT NULL, payment_transfer_id text, status text DEFAULT 'PENDING'::text NOT NULL, failure_reason text, paid_at timestamp with time zone, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, payment_provider text);

CREATE TABLE IF NOT EXISTS public.events (id uuid DEFAULT gen_random_uuid() NOT NULL, organizer_id uuid NOT NULL, title text NOT NULL, description text, category text DEFAULT 'General'::text NOT NULL, cover_image_url text, location_address text, location_online boolean DEFAULT false, online_link text, lat numeric(10,7), lng numeric(10,7), ward text, lga text, state text, start_time timestamp with time zone NOT NULL, end_time timestamp with time zone, timezone text DEFAULT 'Africa/Lagos'::text NOT NULL, status text DEFAULT 'DRAFT'::text NOT NULL, visibility text DEFAULT 'PUBLIC'::text NOT NULL, payout_mode text DEFAULT 'POST_EVENT'::text NOT NULL, payout_released_at timestamp with time zone, payment_subaccount_id text, published_at timestamp with time zone, scheduled_publish_at timestamp with time zone, attendee_count integer DEFAULT 0 NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, share_count integer DEFAULT 0, image_urls text[] DEFAULT '{}'::text[], video_urls text[], moderation_status text DEFAULT 'approved'::text NOT NULL, is_archived boolean DEFAULT false, location_geom geography(Point,4326));

CREATE TABLE IF NOT EXISTS public.followers (id uuid DEFAULT gen_random_uuid() NOT NULL, follower_id uuid NOT NULL, following_id uuid NOT NULL, created_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.friend_requests (id uuid DEFAULT uuid_generate_v4() NOT NULL, from_user_id uuid, to_user_id uuid, participant_ids text[] NOT NULL, status text DEFAULT 'pending'::text NOT NULL, "timestamp" timestamp with time zone DEFAULT now(), created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.item_chats (id uuid DEFAULT uuid_generate_v4() NOT NULL, item_id text NOT NULL, buyer_id uuid, seller_id uuid, item_title text NOT NULL, item_image_url text, last_message_at timestamp with time zone DEFAULT now(), last_message text, last_activity timestamp with time zone DEFAULT now(), is_active boolean DEFAULT true, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.lga_wards (id uuid DEFAULT gen_random_uuid() NOT NULL, state text NOT NULL, lga text NOT NULL, ward text NOT NULL, latitude numeric, longitude numeric, created_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.marketing_rate_limits (id uuid DEFAULT gen_random_uuid() NOT NULL, ip_address text NOT NULL, event_id text NOT NULL, created_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.messages (id uuid DEFAULT gen_random_uuid() NOT NULL, conversation_id uuid NOT NULL, sender_id uuid NOT NULL, text text, image_url text, "timestamp" timestamp with time zone DEFAULT now(), is_read boolean DEFAULT false, read_by text[] DEFAULT '{}'::text[], created_at timestamp with time zone DEFAULT now(), video_url text, media_url text, media_type text, deleted_by text[] DEFAULT '{}'::text[]);

CREATE TABLE IF NOT EXISTS public.moderation_queue (id uuid DEFAULT gen_random_uuid() NOT NULL, content_id uuid NOT NULL, table_name text NOT NULL, user_id uuid NOT NULL, status text DEFAULT 'pending'::text NOT NULL, reason text, text_content text, image_urls text[], created_at timestamp with time zone DEFAULT now(), reviewed_at timestamp with time zone, reviewer_id uuid, notes text);

CREATE TABLE IF NOT EXISTS public.my_tickets (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid NOT NULL, event_id uuid NOT NULL, status text DEFAULT 'active'::text NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL);

CREATE TABLE IF NOT EXISTS public.notifications (id uuid DEFAULT uuid_generate_v4() NOT NULL, user_id uuid, sender_id uuid, type text NOT NULL, title character varying(255) DEFAULT 'Notification'::character varying NOT NULL, message text NOT NULL, related_id uuid, related_type character varying(50), data jsonb DEFAULT '{}'::jsonb, is_read boolean DEFAULT false, read_at timestamp with time zone, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.payment_reconciliation_flags (id uuid DEFAULT gen_random_uuid() NOT NULL, provider text NOT NULL, reference text NOT NULL, transaction_id uuid, reason text NOT NULL, payload jsonb DEFAULT '{}'::jsonb NOT NULL, status text DEFAULT 'open'::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, resolved_at timestamp with time zone);

CREATE TABLE IF NOT EXISTS public.payout_requests (id uuid DEFAULT uuid_generate_v4() NOT NULL, seller_id uuid, account_id uuid, amount numeric(10,2) NOT NULL, status text DEFAULT 'pending'::text NOT NULL, requested_at timestamp with time zone DEFAULT now(), processed_at timestamp with time zone, failure_reason text, transaction_reference text, transaction_id uuid, payment_provider text);

CREATE TABLE IF NOT EXISTS public.post_bookmarks (id uuid DEFAULT gen_random_uuid() NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, user_id uuid NOT NULL, post_id uuid NOT NULL);

CREATE TABLE IF NOT EXISTS public.post_reports (id uuid DEFAULT gen_random_uuid() NOT NULL, post_id uuid NOT NULL, reporter_id uuid NOT NULL, reason text NOT NULL, status text DEFAULT 'open'::text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.posts (id uuid DEFAULT uuid_generate_v4() NOT NULL, user_id uuid, author_name text NOT NULL, author_image text, text text NOT NULL, description text, image_url text, image_urls text[], "timestamp" timestamp with time zone DEFAULT now(), comment_count integer DEFAULT 0, category post_category NOT NULL, title text, event_date text, event_time text, event_link text, event_location jsonb, attendees text[] DEFAULT '{}'::text[], price numeric(10,2), liked_by uuid[] DEFAULT '{}'::uuid[], created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), is_sold boolean DEFAULT false, sold_to_user_id uuid, sold_at timestamp with time zone, transaction_id uuid, author_location jsonb, location jsonb, state text, lga text, ward text, video_thumbnail_url text, image_width numeric, image_height numeric, sub_category text, condition text, negotiable boolean DEFAULT false, view_count integer DEFAULT 0, share_count integer DEFAULT 0, visibility text DEFAULT 'public'::text, video_urls text[], lat double precision, lng double precision, moderation_status text DEFAULT 'approved'::text NOT NULL, location_geom geography(Point,4326), is_edited boolean DEFAULT false);

CREATE TABLE IF NOT EXISTS public.provider_availability (id uuid DEFAULT gen_random_uuid() NOT NULL, business_id uuid NOT NULL, day_of_week integer NOT NULL, start_time time without time zone NOT NULL, end_time time without time zone NOT NULL, is_available boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, staff_id uuid);

CREATE TABLE IF NOT EXISTS public.push_subscriptions (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid, subscription jsonb NOT NULL, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.quote_messages (id uuid DEFAULT gen_random_uuid() NOT NULL, quote_id uuid NOT NULL, sender_id uuid NOT NULL, body text NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.quote_requests (id uuid DEFAULT gen_random_uuid() NOT NULL, customer_id uuid NOT NULL, business_id uuid NOT NULL, staff_id uuid, category text NOT NULL, title text NOT NULL, description text NOT NULL, images text[] DEFAULT '{}'::text[] NOT NULL, location_text text, urgency text, status quote_status DEFAULT 'pending'::quote_status NOT NULL, estimated_price numeric, estimated_duration_minutes integer, estimate_notes text, expires_at timestamp with time zone, converted_booking_id uuid, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.rate_limits (ip_address text, endpoint text NOT NULL, request_count integer DEFAULT 1, window_start timestamp with time zone DEFAULT now(), user_id uuid);

CREATE TABLE IF NOT EXISTS public.reports (id uuid DEFAULT gen_random_uuid() NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, reporter_id uuid, reported_post_id uuid, reported_user_id uuid, reason text, status text DEFAULT 'PENDING'::text NOT NULL, user_id uuid, category text, subject text, description text, image_url text);

CREATE TABLE IF NOT EXISTS public.safety_alerts (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid NOT NULL, title text NOT NULL, description text NOT NULL, severity text NOT NULL, type text NOT NULL, area_name text NOT NULL, state text, lga text, ward text, action text, status text DEFAULT 'pending'::text NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, is_resolved boolean DEFAULT false NOT NULL, resolved_at timestamp with time zone, reviewed_at timestamp with time zone);

CREATE TABLE IF NOT EXISTS public.seller_accounts (id uuid DEFAULT uuid_generate_v4() NOT NULL, user_id uuid, account_type account_type NOT NULL, account_details jsonb NOT NULL, verification_status verification_status DEFAULT 'pending'::verification_status NOT NULL, verification_level verification_level DEFAULT 'basic'::verification_level NOT NULL, is_primary boolean DEFAULT false, is_active boolean DEFAULT true, verified_at timestamp with time zone, rejected_reason text, verification_data jsonb DEFAULT '{}'::jsonb, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), flutterwave_subaccount_id text, payout_enabled boolean DEFAULT false, account_updated_at timestamp with time zone, paystack_subaccount_id text, paystack_subaccount_status text DEFAULT 'pending'::text);

CREATE TABLE IF NOT EXISTS public.service_offerings (id uuid DEFAULT gen_random_uuid() NOT NULL, business_id uuid NOT NULL, name text NOT NULL, description text, duration_minutes integer NOT NULL, price numeric(10,2), price_is_from boolean DEFAULT false NOT NULL, category text, is_active boolean DEFAULT true NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, deposit_required boolean DEFAULT false NOT NULL, deposit_amount numeric, deposit_percent integer, requires_full_payment boolean DEFAULT false NOT NULL, escrow_enabled boolean DEFAULT false NOT NULL);

CREATE TABLE IF NOT EXISTS public.service_staff_assignments (service_id uuid NOT NULL, staff_id uuid NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.sms_delivery_logs (id uuid DEFAULT gen_random_uuid() NOT NULL, message_id text NOT NULL, receiver text, status text, network text, full_payload jsonb, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL);

CREATE TABLE IF NOT EXISTS public.strike_appeals (id uuid DEFAULT gen_random_uuid() NOT NULL, booking_id uuid NOT NULL, appellant_id uuid NOT NULL, appellant_type text NOT NULL, reason text NOT NULL, evidence_urls text[] DEFAULT '{}'::text[] NOT NULL, status text DEFAULT 'pending'::text NOT NULL, reviewed_by uuid, reviewed_at timestamp with time zone, resolution_note text, created_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.ticket_tiers (id uuid DEFAULT gen_random_uuid() NOT NULL, event_id uuid NOT NULL, name text NOT NULL, description text, price numeric(12,2) DEFAULT 0 NOT NULL, capacity integer, sold integer DEFAULT 0 NOT NULL, is_visible boolean DEFAULT true NOT NULL, sale_ends_at timestamp with time zone, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.tickets (id uuid DEFAULT gen_random_uuid() NOT NULL, buyer_id uuid NOT NULL, event_id uuid NOT NULL, tier_id uuid NOT NULL, attendee_name text NOT NULL, attendee_email text NOT NULL, attendee_phone text, status text DEFAULT 'PAID'::text NOT NULL, payment_tx_ref text, payment_provider_ref text, amount_paid numeric(12,2) DEFAULT 0 NOT NULL, scanned_at timestamp with time zone, scanned_by uuid, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL, ticket_code text NOT NULL, qr_data text, expires_at timestamp with time zone, is_archived boolean DEFAULT false, is_used boolean DEFAULT false NOT NULL, checked_in boolean DEFAULT false NOT NULL, checked_in_at timestamp with time zone, refund_status text, refund_requested_at timestamp with time zone, purchase_ticket_index integer, payment_provider text, settlement_mode text DEFAULT 'unknown'::text NOT NULL);

CREATE TABLE IF NOT EXISTS public.transactions (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid NOT NULL, post_id uuid, amount numeric NOT NULL, status text DEFAULT 'completed'::text NOT NULL, tx_ref text NOT NULL, type text NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL);

CREATE TABLE IF NOT EXISTS public.typing_status (id uuid DEFAULT gen_random_uuid() NOT NULL, conversation_id uuid NOT NULL, user_id uuid NOT NULL, is_typing boolean DEFAULT false, updated_at timestamp with time zone DEFAULT now());

CREATE TABLE IF NOT EXISTS public.user_blocks (id uuid DEFAULT gen_random_uuid() NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, blocker_id uuid NOT NULL, blocked_id uuid NOT NULL);

CREATE TABLE IF NOT EXISTS public.user_push_tokens (id uuid DEFAULT gen_random_uuid() NOT NULL, user_id uuid NOT NULL, device_id text NOT NULL, push_token text NOT NULL, device_name text, os_name text, os_version text, app_version text, last_used_at timestamp with time zone DEFAULT now() NOT NULL, created_at timestamp with time zone DEFAULT now() NOT NULL, updated_at timestamp with time zone DEFAULT now() NOT NULL);

CREATE TABLE IF NOT EXISTS public.user_reviews (id uuid DEFAULT gen_random_uuid() NOT NULL, created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL, seller_id uuid NOT NULL, buyer_id uuid NOT NULL, transaction_id uuid, rating integer NOT NULL, comment text, verified_purchase boolean DEFAULT true);

CREATE TABLE IF NOT EXISTS public.users (id uuid NOT NULL, name text NOT NULL, email text, username text, avatar_url text, bio text, location jsonb, friends uuid[] DEFAULT '{}'::uuid[], blocked_users uuid[] DEFAULT '{}'::uuid[], notification_settings jsonb DEFAULT '{"comments": true, "messages": true, "postLikes": true, "postUpdates": true, "eventInvites": true, "friendRequests": true}'::jsonb, is_online boolean DEFAULT false, last_seen timestamp with time zone, onboarding_status onboarding_step DEFAULT 'signup'::onboarding_step, profile_completed boolean DEFAULT false, onboarding_completed_at timestamp with time zone, tour_completed boolean DEFAULT false, welcome_message_sent boolean DEFAULT false, created_at timestamp with time zone DEFAULT now(), updated_at timestamp with time zone DEFAULT now(), interests text[] DEFAULT '{}'::text[], share_location boolean DEFAULT true, current_location jsonb, location_updated_at timestamp with time zone, is_admin boolean DEFAULT false NOT NULL, email_reminders_enabled boolean DEFAULT true NOT NULL, digest_reminder_sent_at timestamp with time zone, role text DEFAULT 'user'::text NOT NULL, discoverable boolean DEFAULT true NOT NULL, legal_name text, review_count integer DEFAULT 0, rating numeric DEFAULT 0, verified_seller boolean DEFAULT false, phone text, phone_verified boolean DEFAULT false NOT NULL, phone_verified_at timestamp with time zone, delete_requested_at timestamp with time zone, delete_requested boolean DEFAULT false, home_state text, home_lga text, home_ward text, home_lat double precision, home_lng double precision, payluk_customer_id text, home_location_geom geography(Point,4326), no_show_count integer DEFAULT 0 NOT NULL, late_cancellation_count integer DEFAULT 0 NOT NULL, is_flagged boolean DEFAULT false NOT NULL, is_suspended boolean DEFAULT false NOT NULL, is_banned boolean DEFAULT false NOT NULL, status text DEFAULT 'active'::text NOT NULL, suspension_reason text, suspended_at timestamp with time zone);

CREATE TABLE IF NOT EXISTS public.verification_documents (id uuid DEFAULT uuid_generate_v4() NOT NULL, user_id uuid, document_type text NOT NULL, document_url text NOT NULL, status verification_status DEFAULT 'pending'::verification_status NOT NULL, uploaded_at timestamp with time zone DEFAULT now(), verified_at timestamp with time zone, rejected_reason text);

CREATE OR REPLACE FUNCTION public.abandon_checkout_reservation(p_transaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE tx public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO tx FROM public.escrow_transactions WHERE id = p_transaction_id FOR UPDATE;
 IF NOT FOUND OR tx.status NOT IN ('pending','creating_escrow') OR tx.payluk_escrow_id IS NOT NULL THEN RETURN; END IF;
 IF tx.item_type = 'catalog_item' AND tx.metadata->>'inventory_reserved' = 'true' THEN
  PERFORM public.release_catalog_stock(tx.item_id::uuid,1);
 END IF;
 UPDATE public.escrow_transactions SET status = 'cancelled',metadata = coalesce(metadata,'{}'::jsonb) || '{"inventory_reserved":false}'::jsonb,updated_at = now() WHERE id = tx.id;
END; $function$;

CREATE OR REPLACE FUNCTION public.accept_community_invite(p_community_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- ensure invite exists and is pending
  update public.community_invites
    set status='accepted', responded_at=now()
    where community_id = p_community_id
      and invited_user_id = v_user
      and status='pending';

  if not found then
    raise exception 'no pending invite';
  end if;

  -- insert membership if not already member
  insert into public.community_memberships (community_id, user_id, role, status, is_auto_joined)
  values (p_community_id, v_user, 'member', 'active', false)
  on conflict do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_friend_request(req_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  req RECORD;
  u1_friends TEXT[];
  u2_friends TEXT[];
BEGIN
  -- Get the request
  SELECT * INTO req FROM friend_requests WHERE id = req_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  IF auth.uid() != req.to_user_id THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Update request status
  UPDATE friend_requests SET status = 'accepted', updated_at = now() WHERE id = req_id;

  -- Update from_user
  SELECT friends INTO u1_friends FROM users WHERE id = req.from_user_id;
  IF u1_friends IS NULL THEN u1_friends := ARRAY[]::TEXT[]; END IF;
  IF NOT (req.to_user_id::TEXT = ANY(u1_friends)) THEN
    UPDATE users SET friends = array_append(u1_friends, req.to_user_id::TEXT) WHERE id = req.from_user_id;
  END IF;

  -- Update to_user
  SELECT friends INTO u2_friends FROM users WHERE id = req.to_user_id;
  IF u2_friends IS NULL THEN u2_friends := ARRAY[]::TEXT[]; END IF;
  IF NOT (req.from_user_id::TEXT = ANY(u2_friends)) THEN
    UPDATE users SET friends = array_append(u2_friends, req.from_user_id::TEXT) WHERE id = req.to_user_id;
  END IF;

END;
$function$;

CREATE OR REPLACE FUNCTION public.adjust_ticket_tier_sold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  was_active boolean;
  is_active boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    is_active := NEW.status IN ('PAID', 'USED');
  ELSIF TG_OP = 'UPDATE' THEN
    was_active := OLD.status IN ('PAID', 'USED');
    is_active := NEW.status IN ('PAID', 'USED');
    IF NEW.status = 'USED' AND OLD.status IS DISTINCT FROM NEW.status AND OLD.refund_status IS NOT NULL THEN
      RAISE EXCEPTION 'Ticket has a refund request and cannot be checked in';
    END IF;
    IF NEW.tier_id IS DISTINCT FROM OLD.tier_id THEN
      RAISE EXCEPTION 'Ticket tier cannot be changed';
    END IF;
    IF was_active = is_active THEN RETURN NEW; END IF;
  ELSE
    was_active := OLD.status IN ('PAID', 'USED');
  END IF;

  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND was_active AND NOT is_active) THEN
    IF was_active THEN
      UPDATE public.ticket_tiers SET sold = greatest(0, coalesce(sold, 0) - 1)
      WHERE id = OLD.tier_id;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF is_active THEN
    UPDATE public.ticket_tiers SET sold = coalesce(sold, 0) + 1
    WHERE id = NEW.tier_id AND (capacity IS NULL OR coalesce(sold, 0) < capacity);
    IF NOT FOUND THEN RAISE EXCEPTION 'ticket_tier_sold_out'; END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.append_dispute_evidence(p_dispute_id uuid, p_user_id uuid, p_evidence jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dispute public.disputes%ROWTYPE;
  v_transaction public.escrow_transactions%ROWTYPE;
  v_previous jsonb;
  v_next jsonb;
BEGIN
  SELECT * INTO v_dispute FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute not found' USING ERRCODE = 'P0002'; END IF;
  IF v_dispute.status NOT IN ('open', 'under_review') THEN
    RAISE EXCEPTION 'Evidence can only be added to an open dispute' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_transaction FROM public.escrow_transactions WHERE id = v_dispute.transaction_id;
  IF p_user_id IS NULL OR (p_user_id IS DISTINCT FROM v_transaction.buyer_id AND p_user_id IS DISTINCT FROM v_transaction.seller_id) THEN
    RAISE EXCEPTION 'Only a transaction participant can submit evidence' USING ERRCODE = '42501';
  END IF;

  v_previous := CASE WHEN p_user_id = v_transaction.buyer_id
    THEN coalesce(v_dispute.buyer_evidence, '{}'::jsonb)
    ELSE coalesce(v_dispute.seller_evidence, '{}'::jsonb) END;
  v_next := v_previous
    || (coalesce(p_evidence, '{}'::jsonb) - 'photos' - 'chatScreenshots' - 'description')
    || jsonb_build_object(
      'photos', coalesce(v_previous->'photos', '[]'::jsonb) || coalesce(p_evidence->'photos', '[]'::jsonb),
      'chatScreenshots', coalesce(v_previous->'chatScreenshots', '[]'::jsonb) || coalesce(p_evidence->'chatScreenshots', '[]'::jsonb)
    );
  IF nullif(p_evidence->>'description', '') IS NOT NULL THEN
    v_next := jsonb_set(
      v_next,
      '{description}',
      to_jsonb(concat_ws(E'\n\n', nullif(v_previous->>'description', ''), nullif(p_evidence->>'description', ''))),
      true
    );
  END IF;

  IF p_user_id = v_transaction.buyer_id THEN
    UPDATE public.disputes SET buyer_evidence = v_next, updated_at = now() WHERE id = p_dispute_id;
  ELSE
    UPDATE public.disputes SET seller_evidence = v_next, updated_at = now() WHERE id = p_dispute_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_escrow_payment(p_transaction_id uuid, p_provider text, p_reference text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE tx public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO tx FROM public.escrow_transactions WHERE id = p_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown transaction'; END IF;
 IF tx.status IN ('paid','shipped','delivered','completed') THEN RETURN 'replay'; END IF;
 IF tx.status NOT IN ('pending','creating_escrow','reconciling') THEN
  INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
  VALUES(p_provider,p_reference,tx.id,'late_success') ON CONFLICT DO NOTHING;
  RETURN 'review';
 END IF;
 IF tx.item_type = 'catalog_item' AND coalesce(tx.metadata->>'inventory_reserved','false') <> 'true' THEN
  IF NOT public.reserve_catalog_stock(tx.item_id::uuid,1) THEN
   INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
   VALUES(p_provider,p_reference,tx.id,'paid_without_stock') ON CONFLICT DO NOTHING;
   UPDATE public.escrow_transactions SET status = 'reconciling',updated_at = now() WHERE id = tx.id;
   RETURN 'review';
  END IF;
  tx.metadata := coalesce(tx.metadata,'{}'::jsonb) || '{"inventory_reserved":true}'::jsonb;
 END IF;
 UPDATE public.escrow_transactions SET status = 'paid',payment_provider = p_provider,
 payment_reference = p_reference,paid_at = now(),updated_at = now(),metadata = tx.metadata WHERE id = tx.id;
 IF coalesce(tx.item_type,'post') = 'post' THEN
  UPDATE public.posts SET is_sold = true,sold_to_user_id = tx.buyer_id,sold_at = now(),transaction_id = tx.id,updated_at = now()
  WHERE id::text = tx.item_id AND (is_sold = false OR transaction_id = tx.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing changed before payment'; END IF;
 END IF;
 RETURN 'applied';
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_escrow_refund(p_transaction_id uuid, p_provider_reference text, p_refund_amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE tx public.escrow_transactions%ROWTYPE;
BEGIN
 SELECT * INTO tx FROM public.escrow_transactions WHERE id = p_transaction_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown transaction'; END IF;
 IF tx.status = 'cancelled' THEN RETURN false; END IF;
 IF tx.status = 'completed' THEN
   INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
   VALUES ('payluk',p_provider_reference,tx.id,'refund_after_completion') ON CONFLICT DO NOTHING;
   RETURN false;
 END IF;
 IF p_refund_amount IS NULL OR p_refund_amount < 0 OR p_refund_amount > tx.amount THEN RAISE EXCEPTION 'Invalid refund amount'; END IF;
 IF p_refund_amount <> tx.amount THEN
  INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
  VALUES('payluk',p_provider_reference,tx.id,'partial_refund_requires_resolution') ON CONFLICT DO NOTHING;
  RETURN false;
 END IF;
 UPDATE public.escrow_transactions SET status = 'cancelled', updated_at = now() WHERE id = tx.id;
 UPDATE public.disputes SET refund_amount = p_refund_amount, status = 'resolved', resolution = 'refund',
   resolved_at = now(), updated_at = now() WHERE transaction_id = tx.id;
 IF NOT FOUND THEN
   INSERT INTO public.disputes(transaction_id,opened_by,dispute_reason,status,resolution,refund_amount,resolved_at)
   VALUES(tx.id,tx.buyer_id,'Provider refund','resolved','refund',p_refund_amount,now());
 END IF;
 IF tx.item_type = 'ticket' OR tx.metadata ? 'event_id' THEN
   UPDATE public.tickets SET status = 'REFUNDED', refund_status = 'processed', updated_at = now()
   WHERE payment_tx_ref = tx.id::text OR payment_provider_ref = p_provider_reference;
 ELSIF tx.item_type = 'catalog_item' THEN
   IF tx.metadata->>'inventory_reserved' = 'true' THEN
     PERFORM public.release_catalog_stock(tx.item_id::uuid,1);
   ELSE
     INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
     VALUES('payluk',p_provider_reference,tx.id,'legacy_stock_refund') ON CONFLICT DO NOTHING;
   END IF;
 ELSE
   UPDATE public.posts SET is_sold = false,sold_to_user_id = NULL,sold_at = NULL,transaction_id = NULL
   WHERE id::text = tx.item_id AND transaction_id = tx.id;
 END IF;
 RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION public.approve_community_join_request(p_community_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_reviewer uuid := auth.uid();
begin
  if not is_community_mod_or_admin(p_community_id, v_reviewer) then
    raise exception 'not authorized';
  end if;

  update public.community_join_requests
    set status='approved', reviewed_by=v_reviewer, reviewed_at=now()
    where community_id=p_community_id and user_id=p_user_id and status='pending';

  if not found then
    raise exception 'no pending request';
  end if;

  insert into public.community_memberships (community_id, user_id, role, status, is_auto_joined)
  values (p_community_id, p_user_id, 'member', 'active', false)
  on conflict do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.begin_dispute_resolution(p_dispute_id uuid, p_admin_id uuid, p_resolution text, p_refund_amount numeric, p_seller_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dispute public.disputes%ROWTYPE;
  v_transaction public.escrow_transactions%ROWTYPE;
  v_operation public.dispute_resolution_operations%ROWTYPE;
BEGIN
  SELECT * INTO v_dispute FROM public.disputes WHERE id = p_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Dispute not found' USING ERRCODE = 'P0002'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND is_admin = true) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  -- Return an existing operation before checking current transaction status or
  -- request amounts. A retry after a committed resolution must never replay a payment.
  SELECT * INTO v_operation
  FROM public.dispute_resolution_operations
  WHERE dispute_id = p_dispute_id;
  IF FOUND THEN
    IF v_operation.status = 'retryable' THEN
      UPDATE public.dispute_resolution_operations
      SET status = 'processing', requested_by = p_admin_id, error_message = NULL, updated_at = now()
      WHERE id = v_operation.id
      RETURNING * INTO v_operation;
      RETURN jsonb_build_object('operation', to_jsonb(v_operation), 'newly_created', true);
    END IF;
    RETURN jsonb_build_object('operation', to_jsonb(v_operation), 'newly_created', false);
  END IF;

  IF p_resolution IS NULL OR length(trim(p_resolution)) = 0 OR length(p_resolution) > 1000 THEN
    RAISE EXCEPTION 'A valid resolution is required' USING ERRCODE = '22023';
  END IF;
  IF p_refund_amount IS NULL OR p_seller_amount IS NULL OR p_refund_amount < 0 OR p_seller_amount < 0 THEN
    RAISE EXCEPTION 'Resolution amounts must be non-negative numbers' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_transaction FROM public.escrow_transactions WHERE id = v_dispute.transaction_id FOR UPDATE;
  IF NOT FOUND OR v_transaction.status::text <> 'disputed' THEN
    RAISE EXCEPTION 'Transaction is not in a disputed state' USING ERRCODE = '22023';
  END IF;
  IF v_transaction.payment_provider = 'payluk' AND v_dispute.provider_submission_status <> 'submitted' THEN
    RAISE EXCEPTION 'Payluk dispute must be submitted successfully before resolution' USING ERRCODE = '22023';
  END IF;
  IF v_transaction.payment_provider = 'payluk'
     AND v_dispute.provider_seller_reply_status IN ('processing', 'needs_reconciliation') THEN
    RAISE EXCEPTION 'Payluk seller reply must be reconciled before resolution' USING ERRCODE = '22023';
  END IF;
  IF v_dispute.status NOT IN ('open', 'under_review') THEN
    RAISE EXCEPTION 'Dispute is not open for resolution' USING ERRCODE = '22023';
  END IF;
  IF p_refund_amount + p_seller_amount <> v_transaction.amount THEN
    RAISE EXCEPTION 'Refund and seller amounts must equal the transaction amount' USING ERRCODE = '22023';
  END IF;
  IF v_transaction.payment_provider IS DISTINCT FROM 'payluk'
     AND p_refund_amount > 0
     AND nullif(v_transaction.payment_reference, '') IS NULL THEN
    RAISE EXCEPTION 'Missing payment reference for refund' USING ERRCODE = '22023';
  END IF;
  IF v_transaction.payment_provider IS DISTINCT FROM 'payluk'
     AND p_refund_amount > 0 AND p_seller_amount > 0 THEN
    RAISE EXCEPTION 'Partial split resolutions are only supported for Payluk transactions' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.dispute_resolution_operations (
    dispute_id, requested_by, resolution, refund_amount, seller_amount,
    payment_provider, status
  ) VALUES (
    p_dispute_id, p_admin_id, trim(p_resolution), p_refund_amount, p_seller_amount,
    v_transaction.payment_provider, 'processing'
  ) RETURNING * INTO v_operation;

  RETURN jsonb_build_object('operation', to_jsonb(v_operation), 'newly_created', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_message_update_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Check if text or media content is being modified
  IF NEW.text IS DISTINCT FROM OLD.text OR 
     NEW.media_url IS DISTINCT FROM OLD.media_url THEN
     
    -- Only the sender can modify the content
    IF auth.uid() != OLD.sender_id THEN
      RAISE EXCEPTION 'Only the sender can edit or delete this message.';
    END IF;
    
    -- Must be within 15 minutes
    IF (now() - OLD.created_at) > interval '15 minutes' THEN
      RAISE EXCEPTION 'Messages can only be edited or deleted within 15 minutes of sending.';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_old_typing_status()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Delete typing status entries older than 1 hour
  DELETE FROM typing_status 
  WHERE updated_at < NOW() - INTERVAL '1 hour';
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_all_notifications(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.notifications WHERE user_id = p_user_id;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.community_toggle_post_like(p_post_id uuid, p_user_id uuid, p_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  post_community_id uuid;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Cannot change another user''s like';
  END IF;
  IF p_action NOT IN ('like', 'unlike') THEN
    RAISE EXCEPTION 'Invalid like action';
  END IF;
  SELECT community_id INTO post_community_id FROM public.community_posts
  WHERE id = p_post_id AND moderation_status = 'approved';
  IF post_community_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.community_memberships
    WHERE community_id = post_community_id AND user_id = auth.uid() AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Post is not available to this member';
  END IF;

  IF p_action = 'like' THEN
    INSERT INTO public.community_post_likes(post_id, user_id)
    VALUES (p_post_id, auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.community_post_likes
    WHERE post_id = p_post_id AND user_id = auth.uid();
  END IF;
  PERFORM set_config('yrdly.community_like_count_update', 'on', true);
  UPDATE public.community_posts
  SET like_count = (SELECT count(*) FROM public.community_post_likes WHERE post_id = p_post_id),
      updated_at = now()
  WHERE id = p_post_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_rate_limit(p_user_id uuid, p_endpoint text, p_max_requests integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  allowed boolean;
BEGIN
  IF p_user_id IS NULL OR p_endpoint IS NULL OR p_max_requests < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit parameters';
  END IF;

  INSERT INTO public.rate_limits (user_id, endpoint, request_count, window_start)
  VALUES (p_user_id, p_endpoint, 1, now())
  ON CONFLICT (user_id, endpoint) DO UPDATE
    SET request_count = CASE
          WHEN public.rate_limits.window_start IS NULL
            OR public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
          THEN 1
          ELSE public.rate_limits.request_count + 1
        END,
        window_start = CASE
          WHEN public.rate_limits.window_start IS NULL
            OR public.rate_limits.window_start <= now() - make_interval(secs => p_window_seconds)
          THEN now()
          ELSE public.rate_limits.window_start
        END
  RETURNING request_count <= p_max_requests INTO allowed;

  RETURN allowed;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_checkout_reservation(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_id uuid;
BEGIN
 IF p_payload->>'item_type' NOT IN ('post','catalog_item') THEN RAISE EXCEPTION 'Invalid item type'; END IF;
 IF p_payload->>'item_type' = 'catalog_item' AND NOT public.reserve_catalog_stock((p_payload->>'item_id')::uuid,1) THEN
  RAISE EXCEPTION 'Item no longer available' USING ERRCODE = '23514';
 END IF;
 INSERT INTO public.escrow_transactions(item_id,buyer_id,seller_id,amount,commission,total_amount,seller_amount,status,payment_method,delivery_details,item_type,metadata)
 VALUES(p_payload->>'item_id',(p_payload->>'buyer_id')::uuid,(p_payload->>'seller_id')::uuid,
 (p_payload->>'amount')::numeric,(p_payload->>'commission')::numeric,(p_payload->>'total_amount')::numeric,
 (p_payload->>'seller_amount')::numeric,'pending','card',p_payload->'delivery_details',p_payload->>'item_type',
 jsonb_build_object('inventory_reserved',p_payload->>'item_type' = 'catalog_item')) RETURNING id INTO v_id;
 RETURN v_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_type character varying, p_title character varying, p_message text, p_sender_id uuid DEFAULT NULL::uuid, p_related_id uuid DEFAULT NULL::uuid, p_related_type character varying DEFAULT NULL::character varying, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_notification_id UUID;
    v_existing_id UUID;
    v_was_read BOOLEAN;
    v_actor_ids UUID[];
    v_new_actor_ids UUID[];
    v_actor_count INT;
    v_sender_name TEXT;
    v_other_name TEXT;
    v_new_message TEXT := p_message;
    v_recent_threshold TIMESTAMP := NOW() - INTERVAL '24 hours';
BEGIN
    -- Grouping logic for post_like
    IF p_type = 'post_like' AND p_related_id IS NOT NULL AND p_sender_id IS NOT NULL THEN
        SELECT id, is_read, COALESCE(ARRAY(SELECT jsonb_array_elements_text(data->'actor_ids')::uuid), ARRAY[sender_id])
        INTO v_existing_id, v_was_read, v_actor_ids
        FROM public.notifications
        WHERE user_id = p_user_id AND type = p_type AND related_id = p_related_id AND created_at >= v_recent_threshold
        ORDER BY created_at DESC LIMIT 1
        FOR UPDATE;

        IF v_existing_id IS NOT NULL THEN
            IF NOT p_sender_id = ANY(v_actor_ids) THEN
                v_new_actor_ids := array_prepend(p_sender_id, v_actor_ids);
                v_actor_count := array_length(v_new_actor_ids, 1);

                SELECT name INTO v_sender_name FROM public.users WHERE id = v_new_actor_ids[1];
                
                IF v_actor_count = 2 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ' and ' || v_other_name || ' liked your post';
                ELSIF v_actor_count = 3 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ', ' || v_other_name || ' and 1 other liked your post';
                ELSIF v_actor_count > 3 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ', ' || v_other_name || ' and ' || (v_actor_count - 2) || ' others liked your post';
                END IF;

                UPDATE public.notifications
                SET sender_id = p_sender_id, message = v_new_message, is_read = false, updated_at = NOW(),
                    data = jsonb_set(jsonb_set(COALESCE(data, '{}'::jsonb), '{actor_ids}', to_jsonb(v_new_actor_ids)), '{actor_count}', to_jsonb(v_actor_count))
                WHERE id = v_existing_id
                RETURNING id INTO v_notification_id;

                -- Push only if it was previously read
                RETURN jsonb_build_object('id', v_notification_id, 'should_push', v_was_read, 'message', v_new_message);
            ELSE
                RETURN jsonb_build_object('id', v_existing_id, 'should_push', false);
            END IF;
        END IF;
    END IF;

    -- Default insert behavior
    IF p_type = 'post_like' AND p_sender_id IS NOT NULL THEN
        p_data := jsonb_set(jsonb_set(COALESCE(p_data, '{}'::jsonb), '{actor_ids}', to_jsonb(ARRAY[p_sender_id])), '{actor_count}', '1'::jsonb);
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, sender_id, related_id, related_type, data) 
    VALUES (p_user_id, p_type, p_title, p_message, p_sender_id, p_related_id, p_related_type, p_data) 
    RETURNING id INTO v_notification_id;

    RETURN jsonb_build_object('id', v_notification_id, 'should_push', true, 'message', p_message);
END;
$function$;

CREATE OR REPLACE FUNCTION public.finish_dispute_resolution(p_operation_id uuid, p_provider_reference text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_operation public.dispute_resolution_operations%ROWTYPE;
  v_dispute public.disputes%ROWTYPE;
  v_transaction public.escrow_transactions%ROWTYPE;
  v_new_status public.escrow_status;
BEGIN
  SELECT * INTO v_operation FROM public.dispute_resolution_operations WHERE id = p_operation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resolution operation not found' USING ERRCODE = 'P0002'; END IF;
  IF v_operation.status = 'succeeded' THEN RETURN; END IF;
  IF v_operation.status <> 'processing' THEN
    RAISE EXCEPTION 'Resolution requires reconciliation and cannot be replayed' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_dispute FROM public.disputes WHERE id = v_operation.dispute_id FOR UPDATE;
  SELECT * INTO v_transaction FROM public.escrow_transactions WHERE id = v_dispute.transaction_id FOR UPDATE;
  v_new_status := CASE WHEN v_operation.seller_amount > 0 THEN 'completed' ELSE 'cancelled' END;

  UPDATE public.disputes
  SET resolution = v_operation.resolution,
      refund_amount = v_operation.refund_amount,
      seller_amount = v_operation.seller_amount,
      status = 'resolved',
      resolved_by = v_operation.requested_by,
      resolved_at = now(),
      updated_at = now()
  WHERE id = v_dispute.id;

  UPDATE public.escrow_transactions
  SET status = v_new_status, dispute_resolved_at = now(), updated_at = now()
  WHERE id = v_transaction.id;

  IF v_new_status = 'cancelled' AND v_transaction.item_id IS NOT NULL THEN
    IF v_transaction.item_type = 'ticket' OR v_transaction.metadata ? 'event_id' THEN
      UPDATE public.tickets
      SET status = 'REFUNDED', refund_status = 'processed', updated_at = now()
      WHERE payment_tx_ref = v_transaction.id::text
         OR payment_provider_ref IN (v_transaction.payluk_escrow_id, v_transaction.payment_reference);
    ELSIF v_transaction.item_type = 'catalog_item' THEN
      IF v_transaction.metadata->>'inventory_reserved' = 'true' THEN
        PERFORM public.release_catalog_stock(v_transaction.item_id::uuid,1);
      ELSE
        INSERT INTO public.payment_reconciliation_flags(provider,reference,transaction_id,reason)
        VALUES('payluk',coalesce(p_provider_reference,v_transaction.id::text),v_transaction.id,'legacy_stock_refund') ON CONFLICT DO NOTHING;
      END IF;
    ELSE
      UPDATE public.posts
      SET is_sold = false, sold_to_user_id = NULL, sold_at = NULL, transaction_id = NULL
      WHERE id::text = v_transaction.item_id AND transaction_id = v_transaction.id;
    END IF;
  END IF;

  UPDATE public.dispute_resolution_operations
  SET status = 'succeeded', provider_reference = p_provider_reference,
      error_message = NULL, updated_at = now()
  WHERE id = v_operation.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.flag_dispute_resolution_reconciliation(p_operation_id uuid, p_error_message text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.dispute_resolution_operations
  SET status = 'needs_reconciliation',
      error_message = left(coalesce(p_error_message, 'Provider result requires manual review'), 1000),
      updated_at = now()
  WHERE id = p_operation_id AND status = 'processing';
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_auto_join_ward_community()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_ward_comm_id UUID;
  v_lga_comm_id  UUID;
BEGIN
  IF (TG_OP = 'UPDATE') AND
     (NEW.home_ward IS NOT DISTINCT FROM OLD.home_ward) AND
     (NEW.home_lga  IS NOT DISTINCT FROM OLD.home_lga)  AND
     (NEW.home_state IS NOT DISTINCT FROM OLD.home_state) THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.community_memberships
  WHERE user_id = NEW.id AND is_auto_joined = true
    AND community_id IN (
      SELECT id FROM public.communities WHERE type IN ('ward','lga')
    );

  -- Re-join ward community if valid non-empty home_ward
  IF NEW.home_ward IS NOT NULL AND NEW.home_ward != '' AND NEW.home_lga IS NOT NULL AND NEW.home_lga != '' AND NEW.home_state IS NOT NULL AND NEW.home_state != '' THEN
    SELECT id INTO v_ward_comm_id FROM public.communities
    WHERE type = 'ward' AND state = NEW.home_state AND lga = NEW.home_lga AND ward = NEW.home_ward
    LIMIT 1;

    IF v_ward_comm_id IS NOT NULL THEN
      INSERT INTO public.community_memberships(community_id, user_id, role, status, is_auto_joined)
      VALUES (v_ward_comm_id, NEW.id, 'member', 'active', true)
      ON CONFLICT (community_id, user_id) DO UPDATE
        SET status = 'active', is_auto_joined = true, updated_at = NOW();
    END IF;
  END IF;

  -- Re-join LGA community if valid non-empty home_lga
  IF NEW.home_lga IS NOT NULL AND NEW.home_lga != '' AND NEW.home_state IS NOT NULL AND NEW.home_state != '' THEN
    SELECT id INTO v_lga_comm_id FROM public.communities
    WHERE type = 'lga' AND state = NEW.home_state AND lga = NEW.home_lga AND ward IS NULL
    LIMIT 1;

    IF v_lga_comm_id IS NOT NULL THEN
      INSERT INTO public.community_memberships(community_id, user_id, role, status, is_auto_joined)
      VALUES (v_lga_comm_id, NEW.id, 'member', 'active', true)
      ON CONFLICT (community_id, user_id) DO UPDATE
        SET status = 'active', is_auto_joined = true, updated_at = NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_check_community_post_rate_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_daily_limit INT;
  v_today_count INT;
  v_role        TEXT;
BEGIN
  SELECT role INTO v_role FROM public.community_memberships
  WHERE community_id = NEW.community_id AND user_id = NEW.author_id AND status = 'active';

  IF v_role IN ('moderator','admin') THEN RETURN NEW; END IF;

  SELECT post_daily_limit INTO v_daily_limit FROM public.communities WHERE id = NEW.community_id;
  IF v_daily_limit IS NULL OR v_daily_limit = 0 THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO v_today_count FROM public.community_posts
  WHERE community_id = NEW.community_id
    AND author_id = NEW.author_id
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF v_today_count >= v_daily_limit THEN
    RAISE EXCEPTION 'You have reached the post limit for this community (% posts per 24 h).', v_daily_limit;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_community_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.community_posts SET comment_count = comment_count + 1, updated_at = NOW() WHERE id = NEW.post_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.community_posts SET comment_count = GREATEST(0, comment_count - 1), updated_at = NOW() WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_community_member_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'active' THEN
    UPDATE public.communities SET member_count = member_count + 1, updated_at = NOW() WHERE id = NEW.community_id;
  ELSIF TG_OP = 'DELETE' AND OLD.status = 'active' THEN
    UPDATE public.communities SET member_count = GREATEST(0, member_count - 1), updated_at = NOW() WHERE id = OLD.community_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status != 'active' AND NEW.status = 'active' THEN
      UPDATE public.communities SET member_count = member_count + 1, updated_at = NOW() WHERE id = NEW.community_id;
    ELSIF OLD.status = 'active' AND NEW.status != 'active' THEN
      UPDATE public.communities SET member_count = GREATEST(0, member_count - 1), updated_at = NOW() WHERE id = OLD.community_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_community_owner_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.approval_status = 'pending' AND NEW.approval_status = 'approved' AND NEW.created_by IS NOT NULL THEN
    INSERT INTO public.community_memberships (community_id, user_id, role, status, is_auto_joined)
    VALUES (NEW.id, NEW.created_by, 'admin', 'active', false)
    ON CONFLICT (community_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_friends_locations(user_id uuid)
 RETURNS TABLE(friend_id uuid, friend_name text, friend_avatar_url text, location jsonb, last_seen timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    u.id,
    u.name,
    u.avatar_url,
    u.current_location,
    u.location_updated_at
  FROM public.users u
  WHERE 
    u.id = ANY(
      SELECT unnest(friends) 
      FROM public.users 
      WHERE id = user_id
    )
    AND u.share_location = true
    AND u.current_location IS NOT NULL
    AND u.location_updated_at > NOW() - INTERVAL '24 hours'; -- Only show locations updated in last 24 hours
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_location_filtered_businesses(user_state text, user_lga text, user_ward text, limit_count integer DEFAULT 50)
 RETURNS TABLE(id uuid, owner_id uuid, name character varying, category character varying, description text, location jsonb, image_urls text[], rating numeric, review_count integer, hours text, phone text, email text, website text, owner_name text, owner_avatar text, created_at timestamp with time zone, updated_at timestamp with time zone, state text, lga text, ward text, location_priority integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    b.*,
    CASE 
      -- Same ward = highest priority
      WHEN b.ward = user_ward AND b.lga = user_lga AND b.state = user_state 
      THEN 1
      -- Same LGA = medium priority
      WHEN b.lga = user_lga AND b.state = user_state 
      THEN 2
      -- Same state = low priority
      WHEN b.state = user_state 
      THEN 3
      -- Different state or no location = lowest priority
      ELSE 4
    END as location_priority
  FROM public.businesses b
  ORDER BY location_priority ASC, b.created_at DESC
  LIMIT limit_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_location_filtered_posts(user_state text, user_lga text, user_ward text, post_category text DEFAULT NULL::text, limit_count integer DEFAULT 50)
 RETURNS TABLE(id uuid, user_id uuid, author_name text, author_image text, text text, description text, image_url text, image_urls text[], "timestamp" timestamp with time zone, comment_count integer, category post_category, title text, event_date text, event_time text, event_link text, event_location jsonb, attendees text[], price numeric, liked_by uuid[], created_at timestamp with time zone, updated_at timestamp with time zone, author_location jsonb, location_priority integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.user_id,
    p.author_name,
    p.author_image,
    p.text,
    p.description,
    p.image_url,
    p.image_urls,
    p.timestamp,
    p.comment_count,
    p.category,
    p.title,
    p.event_date,
    p.event_time,
    p.event_link,
    p.event_location,
    p.attendees,
    p.price,
    p.liked_by,
    p.created_at,
    p.updated_at,
    p.author_location,
    CASE 
      -- Same ward = highest priority
      WHEN p.author_location->>'ward' = user_ward 
        AND p.author_location->>'lga' = user_lga 
        AND p.author_location->>'state' = user_state 
      THEN 1
      -- Same LGA = medium priority
      WHEN p.author_location->>'lga' = user_lga 
        AND p.author_location->>'state' = user_state 
      THEN 2
      -- Same state = low priority
      WHEN p.author_location->>'state' = user_state 
      THEN 3
      -- Different state or no location = lowest priority
      ELSE 4
    END as location_priority
  FROM public.posts p
  WHERE (post_category IS NULL OR p.category = post_category::post_category)
  ORDER BY location_priority ASC, p.timestamp DESC
  LIMIT limit_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_mutual_friends(p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS SETOF users
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN QUERY
  WITH my_mutuals AS (
    SELECT f1.following_id AS mutual_id
    FROM followers f1
    JOIN followers f2 ON f1.following_id = f2.follower_id AND f2.following_id = f1.follower_id
    WHERE f1.follower_id = p_user_id
  ),
  their_mutuals AS (
    SELECT u.id AS user_id, f1.following_id AS mutual_id
    FROM users u
    JOIN followers f1 ON f1.follower_id = u.id
    JOIN followers f2 ON f1.following_id = f2.follower_id AND f2.following_id = f1.follower_id
    WHERE u.id != p_user_id
  )
  SELECT DISTINCT u.* 
  FROM users u
  JOIN their_mutuals tm ON tm.user_id = u.id
  JOIN my_mutuals mm ON mm.mutual_id = tm.mutual_id
  WHERE u.id != p_user_id
    AND u.discoverable IS NOT FALSE
    AND u.id NOT IN (SELECT mutual_id FROM my_mutuals)
  ORDER BY u.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_users_within_radius_with_push_token(lat double precision, lng double precision, radius_km integer)
 RETURNS TABLE(id uuid, push_token text)
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT u.id, u.push_token
  FROM users u
  WHERE u.push_token IS NOT NULL
  AND u.current_location IS NOT NULL
  AND (u.current_location->>'lat') IS NOT NULL
  AND (u.current_location->>'lng') IS NOT NULL
  AND ST_DWithin(
    ST_SetSRID(ST_MakePoint((u.current_location->>'lng')::float, (u.current_location->>'lat')::float), 4326)::geography,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    radius_km * 1000 -- Convert km to meters
  );
$function$;

CREATE OR REPLACE FUNCTION public.guard_booking_payment_and_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  provider_id uuid;
  requires_payment boolean;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  SELECT owner_id INTO provider_id FROM public.businesses WHERE id = OLD.business_id;
  IF actor_id IS DISTINCT FROM OLD.customer_id AND actor_id IS DISTINCT FROM provider_id THEN
    RAISE EXCEPTION 'Only the booking parties may change this booking';
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id THEN
    RAISE EXCEPTION 'Booking identity and payment state cannot be changed by a user';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status NOT IN ('confirmed', 'completed', 'no_show', 'cancelled', 'late_cancelled')
       OR (NEW.status = 'confirmed' AND OLD.status <> 'requested')
       OR (NEW.status IN ('completed', 'no_show') AND OLD.status <> 'confirmed')
       OR (NEW.status IN ('cancelled', 'late_cancelled') AND OLD.status NOT IN ('requested', 'confirmed')) THEN
      RAISE EXCEPTION 'Invalid booking status transition';
    END IF;
    IF NEW.status IN ('cancelled', 'late_cancelled')
       AND OLD.payment_status IN ('deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released') THEN
      RAISE EXCEPTION 'Paid booking cancellation requires assisted refund';
    END IF;
    IF NEW.status IN ('confirmed', 'completed') AND actor_id IS DISTINCT FROM provider_id THEN
      RAISE EXCEPTION 'Only the provider may confirm or complete a booking';
    END IF;
    IF NEW.status = 'confirmed' THEN
      SELECT (deposit_required OR requires_full_payment OR escrow_enabled)
        INTO requires_payment FROM public.service_offerings WHERE id = OLD.service_id;
      IF (requires_payment OR OLD.quote_id IS NOT NULL)
         AND OLD.payment_status NOT IN ('deposit_paid', 'fully_paid', 'escrow_held', 'escrow_released') THEN
        RAISE EXCEPTION 'Payment is required before confirming this booking';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_community_content()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  is_mod boolean;
  post_community_id uuid;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;

  -- Counter updates made by trusted database triggers are not author edits.
  IF TG_TABLE_NAME = 'community_posts' AND TG_OP = 'UPDATE' THEN
    IF pg_trigger_depth() > 1 AND
       (to_jsonb(NEW) - ARRAY['comment_count', 'updated_at']) =
       (to_jsonb(OLD) - ARRAY['comment_count', 'updated_at']) THEN
      RETURN NEW;
    END IF;
    IF current_setting('yrdly.community_like_count_update', true) = 'on' AND
       (to_jsonb(NEW) - ARRAY['like_count', 'updated_at']) =
       (to_jsonb(OLD) - ARRAY['like_count', 'updated_at']) THEN
      RETURN NEW;
    END IF;
  END IF;

  is_mod := public.is_community_mod_or_admin(NEW.community_id, actor_id);

  IF TG_TABLE_NAME = 'community_comments' THEN
    SELECT community_id INTO post_community_id FROM public.community_posts WHERE id = NEW.post_id;
    IF post_community_id IS DISTINCT FROM NEW.community_id THEN
      RAISE EXCEPTION 'Comment must belong to its post community';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.author_id IS DISTINCT FROM actor_id THEN
      RAISE EXCEPTION 'Author must be the signed-in user';
    END IF;
    NEW.moderation_status := 'pending';
    NEW.created_at := now();
    IF TG_TABLE_NAME = 'community_posts' THEN
      NEW.is_pinned := false;
      NEW.like_count := 0;
      NEW.comment_count := 0;
    ELSE
      NEW.like_count := 0;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'community_posts' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.community_id IS DISTINCT FROM OLD.community_id
       OR NEW.author_id IS DISTINCT FROM OLD.author_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Post identity cannot be changed';
    END IF;
    IF NOT is_mod THEN
      IF NEW.is_pinned IS DISTINCT FROM OLD.is_pinned
         OR NEW.like_count IS DISTINCT FROM OLD.like_count
         OR NEW.comment_count IS DISTINCT FROM OLD.comment_count
         OR NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN
        RAISE EXCEPTION 'Only moderators may change post state';
      END IF;
      IF NEW.content IS DISTINCT FROM OLD.content
         OR NEW.image_urls IS DISTINCT FROM OLD.image_urls
         OR NEW.video_urls IS DISTINCT FROM OLD.video_urls THEN
        NEW.moderation_status := 'pending';
      END IF;
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.post_id IS DISTINCT FROM OLD.post_id
       OR NEW.community_id IS DISTINCT FROM OLD.community_id
       OR NEW.author_id IS DISTINCT FROM OLD.author_id
       OR NEW.parent_comment_id IS DISTINCT FROM OLD.parent_comment_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Comment identity cannot be changed';
    END IF;
    IF NOT is_mod THEN
      IF NEW.like_count IS DISTINCT FROM OLD.like_count
         OR NEW.moderation_status IS DISTINCT FROM OLD.moderation_status THEN
        RAISE EXCEPTION 'Only moderators may change comment state';
      END IF;
      IF NEW.content IS DISTINCT FROM OLD.content THEN
        NEW.moderation_status := 'pending';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_community_membership_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  actor_role text;
BEGIN
  -- Internal maintenance and service-role operations do not carry a user JWT.
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  -- The existing auto-join trigger changes memberships while updating a user profile.
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.community_id IS DISTINCT FROM OLD.community_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.joined_at IS DISTINCT FROM OLD.joined_at
     OR NEW.is_auto_joined IS DISTINCT FROM OLD.is_auto_joined THEN
    RAISE EXCEPTION 'Membership identity and origin cannot be changed';
  END IF;

  SELECT role INTO actor_role FROM public.community_memberships
  WHERE community_id = OLD.community_id AND user_id = actor_id AND status = 'active';

  IF actor_id = OLD.user_id AND actor_role NOT IN ('moderator', 'admin') THEN
    IF NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Members may only change their notification preferences';
    END IF;
  ELSIF actor_role IN ('moderator', 'admin') THEN
    IF actor_id = OLD.user_id AND
       (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status) THEN
      RAISE EXCEPTION 'Moderators cannot change their own role or status';
    END IF;
    IF actor_role = 'moderator' AND
       (NEW.role = 'admin' OR OLD.role = 'admin') AND
       (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status) THEN
      RAISE EXCEPTION 'Only an admin may change an admin membership';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not allowed to update this membership';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_quote_request_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  provider_id uuid;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  SELECT owner_id INTO provider_id FROM public.businesses WHERE id = NEW.business_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.customer_id IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'Invalid quote customer'; END IF;
    NEW.status := 'pending';
    NEW.estimated_price := NULL;
    NEW.estimated_duration_minutes := NULL;
    NEW.estimate_notes := NULL;
    NEW.expires_at := NULL;
    NEW.converted_booking_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Quote identity cannot be changed';
  END IF;

  IF actor_id = OLD.customer_id THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'converted_booking_id', 'updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'converted_booking_id', 'updated_at']) THEN
      RAISE EXCEPTION 'Only the provider may change a quote estimate';
    END IF;
    IF (OLD.status = 'estimated' AND NEW.status IN ('accepted', 'rejected'))
       OR (OLD.status IN ('pending', 'estimated') AND NEW.status = 'cancelled') THEN
      IF NEW.converted_booking_id IS DISTINCT FROM OLD.converted_booking_id THEN
        RAISE EXCEPTION 'Cannot link a booking in this status';
      END IF;
    ELSIF OLD.status = 'accepted' AND NEW.status = 'converted'
       AND NEW.converted_booking_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.bookings b
                   WHERE b.id = NEW.converted_booking_id AND b.quote_id = OLD.id
                     AND b.customer_id = actor_id) THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'Invalid quote status transition';
    END IF;
  ELSIF actor_id = provider_id THEN
    IF (to_jsonb(NEW) - ARRAY['status', 'estimated_price', 'estimated_duration_minutes', 'estimate_notes', 'expires_at', 'updated_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['status', 'estimated_price', 'estimated_duration_minutes', 'estimate_notes', 'expires_at', 'updated_at'])
       OR OLD.status NOT IN ('pending', 'estimated') OR NEW.status <> 'estimated'
       OR NEW.estimated_price IS NULL OR NEW.estimated_price < 1000 THEN
      RAISE EXCEPTION 'Provider may only submit a valid estimate';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not allowed to change this quote';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_suspension_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN NEW; END IF;
 IF TG_OP = 'INSERT' THEN
   IF NEW.is_suspended OR NEW.is_banned OR NEW.status <> 'active' OR NEW.suspension_reason IS NOT NULL OR NEW.suspended_at IS NOT NULL THEN
     RAISE EXCEPTION 'Suspension is server managed' USING ERRCODE = '42501';
   END IF;
 ELSIF ROW(NEW.is_suspended,NEW.is_banned,NEW.status,NEW.suspension_reason,NEW.suspended_at) IS DISTINCT FROM
       ROW(OLD.is_suspended,OLD.is_banned,OLD.status,OLD.suspension_reason,OLD.suspended_at) THEN
   RAISE EXCEPTION 'Suspension is server managed' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.guard_ticket_client_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  v_organizer_id uuid;
BEGIN
  IF actor_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.refund_status IS DISTINCT FROM OLD.refund_status
     OR (to_jsonb(NEW) - ARRAY['status', 'scanned_at', 'scanned_by', 'checked_in', 'checked_in_at', 'is_used', 'is_archived', 'updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status', 'scanned_at', 'scanned_by', 'checked_in', 'checked_in_at', 'is_used', 'is_archived', 'updated_at']) THEN
    RAISE EXCEPTION 'Ticket payment and identity fields cannot be changed by a user';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT organizer_id INTO v_organizer_id FROM public.events WHERE id = OLD.event_id;
    IF actor_id IS DISTINCT FROM v_organizer_id OR OLD.status <> 'PAID'
       OR NEW.status <> 'USED' OR OLD.refund_status IS NOT NULL THEN
      RAISE EXCEPTION 'Only the organizer may check in an active ticket';
    END IF;
  ELSIF actor_id IS DISTINCT FROM OLD.buyer_id OR
        (to_jsonb(NEW) - ARRAY['is_archived', 'updated_at']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['is_archived', 'updated_at']) THEN
    RAISE EXCEPTION 'Only the ticket holder may archive this ticket';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_phone_verified()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.phone_verified = TRUE AND (OLD.phone_verified = FALSE OR OLD.phone_verified IS NULL) THEN
    NEW.phone_verified_at = NOW();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_business_view(business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE businesses SET view_count = COALESCE(view_count, 0) + 1 WHERE id = business_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_event_share(event_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE events SET share_count = COALESCE(share_count, 0) + 1 WHERE id = event_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_post_share(post_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE posts SET share_count = COALESCE(share_count, 0) + 1 WHERE id = post_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_community_mod_or_admin(p_community_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.community_memberships
    WHERE community_id = p_community_id
      AND user_id = p_user_id
      AND role IN ('moderator', 'admin')
      AND status = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id uuid, check_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM conversations
    WHERE id = conv_id
    AND check_uid::text = ANY(participant_ids::text[])
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_messages_participant(conv_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = conv_id
      AND auth.uid() = ANY(participant_ids)
  );
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE public.notifications 
    SET is_read = TRUE, read_at = NOW()
    WHERE user_id = p_user_id AND is_read = FALSE;
    
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RETURN updated_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(p_conversation_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Mark all unread messages in the conversation as read for this user
    UPDATE public.messages
    SET 
        is_read = true,
        read_by = array_append(COALESCE(read_by, '{}'), p_user_id::text)
    WHERE 
        conversation_id = p_conversation_id 
        AND sender_id::text != p_user_id::text
        AND NOT (p_user_id::text = ANY(COALESCE(read_by, '{}')));
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    UPDATE public.notifications 
    SET is_read = TRUE, read_at = NOW()
    WHERE id = p_notification_id AND user_id = p_user_id;
    
    RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_marketplace_dispute(p_transaction_id uuid, p_opened_by uuid, p_reason text, p_evidence jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_transaction public.escrow_transactions%ROWTYPE;
  v_dispute_id uuid;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 OR length(p_reason) > 500 THEN
    RAISE EXCEPTION 'A valid dispute reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_transaction
  FROM public.escrow_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_opened_by IS NULL
     OR (p_opened_by IS DISTINCT FROM v_transaction.buyer_id
         AND p_opened_by IS DISTINCT FROM v_transaction.seller_id) THEN
    RAISE EXCEPTION 'Only a transaction participant can open a dispute' USING ERRCODE = '42501';
  END IF;

  IF v_transaction.payment_provider = 'payluk' AND p_opened_by IS DISTINCT FROM v_transaction.buyer_id THEN
    RAISE EXCEPTION 'The buyer must open Payluk disputes; sellers may add evidence after filing' USING ERRCODE = '42501';
  END IF;

  IF v_transaction.status::text NOT IN ('paid', 'shipped', 'delivered') THEN
    RAISE EXCEPTION 'Transaction is not eligible for a dispute' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.disputes WHERE transaction_id = p_transaction_id) THEN
    RAISE EXCEPTION 'A dispute already exists for this transaction' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.disputes (
    transaction_id,
    opened_by,
    dispute_reason,
    buyer_evidence,
    seller_evidence,
    status,
    refund_amount,
    seller_amount,
    created_at,
    updated_at
  ) VALUES (
    p_transaction_id,
    p_opened_by,
    trim(p_reason),
    CASE WHEN v_transaction.buyer_id = p_opened_by THEN coalesce(p_evidence, '{}'::jsonb) ELSE '{}'::jsonb END,
    CASE WHEN v_transaction.seller_id = p_opened_by THEN coalesce(p_evidence, '{}'::jsonb) ELSE '{}'::jsonb END,
    'open',
    0,
    0,
    now(),
    now()
  ) RETURNING id INTO v_dispute_id;

  UPDATE public.escrow_transactions
  SET status = 'disputed', dispute_reason = trim(p_reason), updated_at = now()
  WHERE id = p_transaction_id;

  RETURN v_dispute_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_business_self_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT owner_id
    INTO v_owner_id
    FROM public.businesses
    WHERE id = NEW.business_id;

  IF v_owner_id IS NOT NULL AND v_owner_id = NEW.user_id THEN
    RAISE EXCEPTION 'You cannot review your own business'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_client_admin_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (auth.jwt() ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_admin IS TRUE OR NEW.role = 'admin' THEN
      RAISE EXCEPTION 'Only the service role can grant administrator access';
    END IF;
  ELSIF NEW.is_admin IS DISTINCT FROM OLD.is_admin OR NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Only the service role can change administrator access';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prevent_paid_marketplace_listing_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF EXISTS(SELECT 1 FROM public.escrow_transactions tx WHERE tx.item_id = OLD.id::text
   AND COALESCE(tx.item_type,'post') = 'post' AND tx.status <> 'cancelled') THEN
   RAISE EXCEPTION 'This listing has a transaction and cannot be deleted' USING ERRCODE = '23514';
 END IF;
 RETURN OLD;
END; $function$;

CREATE OR REPLACE FUNCTION public.purchase_ticket(p_tier_id uuid, p_buyer_id uuid, p_event_id uuid, p_attendee_name text, p_attendee_email text, p_attendee_phone text, p_amount_paid numeric, p_tx_ref text, p_flw_ref text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket_id UUID;
  v_updated_rows INTEGER;
BEGIN
  -- Try to atomically increment sold count (cap at capacity)
  UPDATE public.ticket_tiers
  SET    sold = sold + 1, updated_at = NOW()
  WHERE  id = p_tier_id
    AND  (capacity IS NULL OR sold < capacity)
    AND  (sale_ends_at IS NULL OR sale_ends_at > NOW());

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RAISE EXCEPTION 'TICKET_SOLD_OUT' USING ERRCODE = 'P0001';
  END IF;

  -- Create the ticket (UUID is the QR token)
  INSERT INTO public.tickets (
    buyer_id, event_id, tier_id,
    attendee_name, attendee_email, attendee_phone,
    status, flutterwave_tx_ref, flutterwave_flw_ref, amount_paid
  ) VALUES (
    p_buyer_id, p_event_id, p_tier_id,
    p_attendee_name, p_attendee_email, p_attendee_phone,
    'PAID', p_tx_ref, p_flw_ref, p_amount_paid
  )
  RETURNING id INTO v_ticket_id;

  -- Increment attendee count on the event
  UPDATE public.events
  SET attendee_count = attendee_count + 1, updated_at = NOW()
  WHERE id = p_event_id;

  RETURN v_ticket_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.queue_community_content_for_moderation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.moderation_status = 'pending' THEN
    INSERT INTO public.moderation_queue
      (content_id, table_name, user_id, status, reason, text_content)
    VALUES (NEW.id, TG_TABLE_NAME, NEW.author_id, 'pending', 'community_review', NEW.content);
  ELSIF TG_OP = 'UPDATE' AND NEW.moderation_status = 'pending' AND
        (OLD.moderation_status IS DISTINCT FROM NEW.moderation_status
         OR OLD.content IS DISTINCT FROM NEW.content) THEN
    INSERT INTO public.moderation_queue
      (content_id, table_name, user_id, status, reason, text_content)
    VALUES (NEW.id, TG_TABLE_NAME, NEW.author_id, 'pending', 'community_review', NEW.content);
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_dispute_resolution(p_dispute_id uuid, p_admin_id uuid, p_outcome text, p_provider_reference text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_operation public.dispute_resolution_operations%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_id AND is_admin = true) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF p_outcome NOT IN ('applied', 'not_applied') THEN
    RAISE EXCEPTION 'Outcome must be applied or not_applied' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_operation
  FROM public.dispute_resolution_operations
  WHERE dispute_id = p_dispute_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Resolution operation not found' USING ERRCODE = 'P0002'; END IF;
  IF p_outcome = 'applied' AND v_operation.status = 'succeeded' THEN RETURN 'succeeded'; END IF;
  IF v_operation.status <> 'needs_reconciliation'
     AND NOT (v_operation.status = 'processing' AND v_operation.updated_at < now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Only flagged or stale operations can be reconciled' USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'applied' THEN
    UPDATE public.dispute_resolution_operations
    SET status = 'processing', updated_at = now()
    WHERE id = v_operation.id;
    PERFORM public.finish_dispute_resolution(v_operation.id, p_provider_reference);
    RETURN 'succeeded';
  END IF;

  UPDATE public.dispute_resolution_operations
  SET status = 'retryable',
      error_message = 'Administrator verified that the provider did not apply the payment and has no pending payment; retry is permitted.',
      updated_at = now()
  WHERE id = v_operation.id;
  RETURN 'retryable';
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_business_review_rating(p_business_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_review_count integer;
  v_average_rating numeric;
BEGIN
  SELECT count(*)::integer, avg(rating)::numeric
    INTO v_review_count, v_average_rating
    FROM public.business_reviews
    WHERE business_id = p_business_id;

  UPDATE public.businesses
    SET review_count = v_review_count,
        rating = CASE
          WHEN v_review_count = 0 THEN 0
          ELSE round(v_average_rating, 2)
        END
    WHERE id = p_business_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.refresh_seller_review_aggregate(seller_uuid uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_catalog_stock(p_item_id uuid, p_qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF p_qty IS NULL OR p_qty < 1 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 UPDATE public.catalog_items SET quantity = coalesce(quantity,inventory_count,0) + p_qty,
 inventory_count = coalesce(quantity,inventory_count,0) + p_qty, in_stock = true, updated_at = now() WHERE id = p_item_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Catalog item not found'; END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.remove_friend(target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  u1_friends TEXT[];
  u2_friends TEXT[];
BEGIN
  -- Update current user
  SELECT friends INTO u1_friends FROM users WHERE id = auth.uid();
  IF u1_friends IS NOT NULL THEN
    UPDATE users SET friends = array_remove(u1_friends, target_user_id::TEXT) WHERE id = auth.uid();
  END IF;

  -- Update target user
  SELECT friends INTO u2_friends FROM users WHERE id = target_user_id;
  IF u2_friends IS NOT NULL THEN
    UPDATE users SET friends = array_remove(u2_friends, auth.uid()::TEXT) WHERE id = target_user_id;
  END IF;

  -- Remove any friend requests
  DELETE FROM friend_requests 
  WHERE (from_user_id = auth.uid() AND to_user_id = target_user_id)
     OR (from_user_id = target_user_id AND to_user_id = auth.uid());

END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_notification_actor(p_user_id uuid, p_type character varying, p_sender_id uuid, p_related_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_notification RECORD;
    v_actor_ids UUID[];
    v_new_actor_ids UUID[];
    v_actor_count INT;
    v_sender_name TEXT;
    v_other_name TEXT;
    v_new_message TEXT;
BEGIN
    SELECT id, message, COALESCE(ARRAY(SELECT jsonb_array_elements_text(data->'actor_ids')::uuid), ARRAY[sender_id]) as actors, data
    INTO v_notification
    FROM public.notifications
    WHERE user_id = p_user_id AND type = p_type AND related_id = p_related_id
    ORDER BY created_at DESC LIMIT 1
    FOR UPDATE;

    IF v_notification.id IS NOT NULL THEN
        v_actor_ids := v_notification.actors;
        
        IF p_sender_id = ANY(v_actor_ids) THEN
            SELECT array_agg(a) INTO v_new_actor_ids FROM unnest(v_actor_ids) a WHERE a != p_sender_id;
            v_actor_count := COALESCE(array_length(v_new_actor_ids, 1), 0);

            IF v_actor_count = 0 THEN
                DELETE FROM public.notifications WHERE id = v_notification.id;
                RETURN true;
            ELSE
                SELECT name INTO v_sender_name FROM public.users WHERE id = v_new_actor_ids[1];
                IF v_actor_count = 1 THEN
                    v_new_message := v_sender_name || ' liked your post';
                ELSIF v_actor_count = 2 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ' and ' || v_other_name || ' liked your post';
                ELSIF v_actor_count = 3 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ', ' || v_other_name || ' and 1 other liked your post';
                ELSIF v_actor_count > 3 THEN
                    SELECT name INTO v_other_name FROM public.users WHERE id = v_new_actor_ids[2];
                    v_new_message := v_sender_name || ', ' || v_other_name || ' and ' || (v_actor_count - 2) || ' others liked your post';
                END IF;

                -- Crucial: updating sender_id, message, and array but explicitly NOT touching is_read
                UPDATE public.notifications
                SET sender_id = v_new_actor_ids[1], message = v_new_message, updated_at = NOW(),
                    data = jsonb_set(jsonb_set(COALESCE(v_notification.data, '{}'::jsonb), '{actor_ids}', to_jsonb(v_new_actor_ids)), '{actor_count}', to_jsonb(v_actor_count))
                WHERE id = v_notification.id;
                RETURN true;
            END IF;
        END IF;
    END IF;
    RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.requeue_seller_payout(p_payout_id uuid, p_seller_id uuid, p_wallet_limit numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_payout public.payout_requests%ROWTYPE;v_earnings numeric;v_spent numeric;v_reserved numeric;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text,0));
 SELECT * INTO v_payout FROM public.payout_requests WHERE id = p_payout_id AND seller_id = p_seller_id FOR UPDATE;
 IF NOT FOUND OR v_payout.status NOT IN ('failed','processing') OR v_payout.payment_provider IS DISTINCT FROM 'payluk'
  OR v_payout.transaction_reference IS NULL OR p_wallet_limit IS NULL THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.seller_accounts WHERE id = v_payout.account_id AND user_id = p_seller_id AND is_active
  AND verification_status = 'verified' AND (account_updated_at IS NULL OR account_updated_at <= now()-interval '24 hours')) THEN RETURN false; END IF;
 SELECT coalesce(sum(seller_amount),0) INTO v_earnings FROM public.escrow_transactions
 WHERE seller_id = p_seller_id AND status = 'completed' AND coalesce(item_type,'post') <> 'ticket' AND payment_provider = 'payluk';
 SELECT coalesce(sum(amount) FILTER(WHERE status = 'completed'),0),coalesce(sum(amount) FILTER(WHERE status IN ('pending','processing')),0)
 INTO v_spent,v_reserved FROM public.payout_requests WHERE seller_id = p_seller_id AND id <> p_payout_id;
 IF v_payout.amount > least(v_earnings-v_spent-v_reserved,p_wallet_limit-v_reserved) THEN RETURN false; END IF;
 UPDATE public.payout_requests SET status = 'pending',failure_reason = NULL WHERE id = v_payout.id;
 RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION public.reserve_catalog_stock(p_item_id uuid, p_qty integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF p_qty IS NULL OR p_qty < 1 THEN RAISE EXCEPTION 'Invalid quantity'; END IF;
 UPDATE public.catalog_items SET
  quantity = coalesce(quantity,inventory_count,CASE WHEN in_stock THEN 1 ELSE 0 END) - p_qty,
  inventory_count = coalesce(quantity,inventory_count,CASE WHEN in_stock THEN 1 ELSE 0 END) - p_qty,
  in_stock = coalesce(quantity,inventory_count,CASE WHEN in_stock THEN 1 ELSE 0 END) > p_qty,
  updated_at = now()
 WHERE id = p_item_id AND in_stock = true
 AND coalesce(quantity,inventory_count,CASE WHEN in_stock THEN 1 ELSE 0 END) >= p_qty;
 RETURN FOUND;
END; $function$;

CREATE OR REPLACE FUNCTION public.reserve_seller_payout(p_seller_id uuid, p_account_id uuid, p_amount numeric, p_wallet_limit numeric, p_transaction_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_earnings numeric;v_spent numeric;v_reserved numeric;v_id uuid;
BEGIN
 IF p_amount IS NULL OR p_amount <= 0 OR p_wallet_limit IS NULL OR p_wallet_limit < p_amount THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_seller_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM public.seller_accounts WHERE id = p_account_id AND user_id = p_seller_id AND is_active
  AND verification_status = 'verified' AND (account_updated_at IS NULL OR account_updated_at <= now()-interval '24 hours')) THEN
  RAISE EXCEPTION 'Verified payout account required';
 END IF;
 SELECT coalesce(sum(seller_amount),0) INTO v_earnings FROM public.escrow_transactions WHERE seller_id = p_seller_id AND status = 'completed' AND coalesce(item_type,'post') <> 'ticket' AND payment_provider = 'payluk';
 SELECT coalesce(sum(amount) FILTER(WHERE status = 'completed'),0),coalesce(sum(amount) FILTER(WHERE status IN ('pending','processing')),0)
 INTO v_spent,v_reserved FROM public.payout_requests WHERE seller_id = p_seller_id;
 IF p_amount > least(v_earnings-v_spent-v_reserved,p_wallet_limit-v_reserved) THEN RAISE EXCEPTION 'Insufficient unreserved balance' USING ERRCODE = '23514'; END IF;
 INSERT INTO public.payout_requests(seller_id,account_id,amount,status,transaction_id,payment_provider)
 VALUES(p_seller_id,p_account_id,p_amount,'pending',p_transaction_id,'payluk') RETURNING id INTO v_id;
 RETURN v_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.reset_conversation_deleted_by()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE conversations
  SET deleted_by = '{}'::text[],
      updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.scan_ticket(p_ticket_id uuid, p_scanner_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ticket        public.tickets%ROWTYPE;
  v_is_organizer  BOOLEAN;
BEGIN
  -- Verify scanner owns the event
  SELECT EXISTS(
    SELECT 1 FROM public.events
    WHERE id = p_event_id AND organizer_id = p_scanner_id
  ) INTO v_is_organizer;

  IF NOT v_is_organizer THEN
    RETURN jsonb_build_object('success', false, 'reason', 'UNAUTHORIZED');
  END IF;

  -- Fetch ticket
  SELECT * INTO v_ticket FROM public.tickets WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'INVALID_TICKET');
  END IF;

  IF v_ticket.event_id <> p_event_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'WRONG_EVENT');
  END IF;

  IF v_ticket.status = 'USED' THEN
    RETURN jsonb_build_object(
      'success', false, 'reason', 'ALREADY_USED',
      'scanned_at', v_ticket.scanned_at
    );
  END IF;

  IF v_ticket.status <> 'PAID' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'INVALID_STATUS', 'status', v_ticket.status);
  END IF;

  -- Mark as USED
  UPDATE public.tickets
  SET status = 'USED', scanned_at = NOW(), scanned_by = p_scanner_id, updated_at = NOW()
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'attendee_name', v_ticket.attendee_name,
    'tier_id', v_ticket.tier_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.scan_ticket(p_ticket_input text, p_scanner_id uuid, p_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_ticket        public.tickets%ROWTYPE;
  v_is_organizer  BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM public.events
    WHERE id = p_event_id AND (organizer_id = p_scanner_id OR user_id = p_scanner_id)
  ) INTO v_is_organizer;

  IF NOT v_is_organizer THEN
    RETURN jsonb_build_object('success', false, 'reason', 'UNAUTHORIZED');
  END IF;

  IF p_ticket_input ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO v_ticket FROM public.tickets
    WHERE (id = p_ticket_input::UUID OR ticket_code = p_ticket_input OR qr_data = p_ticket_input)
    LIMIT 1;
  ELSE
    SELECT * INTO v_ticket FROM public.tickets
    WHERE (ticket_code = p_ticket_input OR qr_data = p_ticket_input)
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'INVALID_TICKET');
  END IF;

  IF v_ticket.event_id <> p_event_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'WRONG_EVENT');
  END IF;

  IF v_ticket.status = 'USED' OR v_ticket.is_used = true OR v_ticket.checked_in = true THEN
    RETURN jsonb_build_object(
      'success', false, 'reason', 'ALREADY_USED',
      'scanned_at', COALESCE(v_ticket.scanned_at, v_ticket.checked_in_at)
    );
  END IF;

  IF v_ticket.status <> 'PAID' AND v_ticket.status <> 'VALID' AND v_ticket.status <> 'CONFIRMED' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'INVALID_STATUS', 'status', v_ticket.status);
  END IF;

  UPDATE public.tickets
  SET status = 'USED', is_used = true, checked_in = true, scanned_at = NOW(), checked_in_at = NOW(), scanned_by = p_scanner_id, updated_at = NOW()
  WHERE id = v_ticket.id;

  RETURN jsonb_build_object(
    'success', true,
    'attendee_name', COALESCE(v_ticket.attendee_name, 'Guest'),
    'ticket_code', v_ticket.ticket_code,
    'tier_id', v_ticket.tier_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_posts_by_distance(lat double precision, lng double precision, radius_meters double precision, filter_category text DEFAULT NULL::text, filter_min_price double precision DEFAULT NULL::double precision, filter_max_price double precision DEFAULT NULL::double precision, filter_condition text DEFAULT NULL::text, sort_order text DEFAULT 'Newest'::text)
 RETURNS SETOF posts
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$
  select *
  from public.posts
  where
    category = 'For Sale'
    and (is_sold is false or is_sold is null)
    and location_geom is not null
    and st_dwithin(location_geom, st_point(lng, lat)::geography, radius_meters)
    and (filter_category is null or sub_category = filter_category)
    and (filter_min_price is null or price >= filter_min_price)
    and (filter_max_price is null or price <= filter_max_price)
    and (filter_condition is null or condition = filter_condition)
  order by
    case when sort_order = 'Price: Low to High' then price end asc nulls last,
    case when sort_order = 'Price: High to Low' then price end desc nulls last,
    case when sort_order = 'Newest' then created_at end desc nulls last,
    -- Distance sorting as a secondary default
    st_distance(location_geom, st_point(lng, lat)::geography) asc;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_location_from_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- If business doesn't have admin_location set, get it from the user's profile
  IF NEW.admin_location IS NULL THEN
    SELECT location INTO NEW.admin_location
    FROM public.users
    WHERE id = NEW.owner_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_post_location_from_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- If post doesn't have location set, get it from the user's profile
  IF NEW.location IS NULL THEN
    SELECT location INTO NEW.location
    FROM public.users
    WHERE id = NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_business_review_aggregate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  current_owner_id uuid;
  previous_owner_id uuid;
begin
  select owner_id into current_owner_id
  from public.businesses
  where id = case when tg_op = 'DELETE' then old.business_id else new.business_id end;
  perform public.refresh_seller_review_aggregate(current_owner_id);

  if tg_op = 'UPDATE' and old.business_id is distinct from new.business_id then
    select owner_id into previous_owner_id from public.businesses where id = old.business_id;
    perform public.refresh_seller_review_aggregate(previous_owner_id);
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_business_review_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_business_review_rating(OLD.business_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.business_id IS DISTINCT FROM NEW.business_id THEN
    PERFORM public.refresh_business_review_rating(OLD.business_id);
  END IF;

  PERFORM public.refresh_business_review_rating(NEW.business_id);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_ticket_checked_in()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'USED' AND (OLD.status IS DISTINCT FROM 'USED') THEN
    NEW.is_used    := TRUE;
    NEW.checked_in := TRUE;
    IF NEW.checked_in_at IS NULL THEN
      NEW.checked_in_at := COALESCE(NEW.scanned_at, NOW());
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_user_review_aggregate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.refresh_seller_review_aggregate(case when tg_op = 'DELETE' then old.seller_id else new.seller_id end);
  if tg_op = 'UPDATE' and old.seller_id is distinct from new.seller_id then
    perform public.refresh_seller_review_aggregate(old.seller_id);
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.toggle_post_like(p_post_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_liked_by UUID[];
  v_is_liked BOOLEAN;
  v_new_liked_by UUID[];
BEGIN
  SELECT COALESCE(liked_by, ARRAY[]::UUID[]) INTO v_liked_by
  FROM public.posts
  WHERE id = p_post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Post % not found', p_post_id;
  END IF;

  v_is_liked := (p_user_id = ANY(v_liked_by));

  IF v_is_liked THEN
    SELECT ARRAY_AGG(elem) INTO v_new_liked_by
    FROM UNNEST(v_liked_by) AS elem
    WHERE elem <> p_user_id;

    v_new_liked_by := COALESCE(v_new_liked_by, ARRAY[]::UUID[]);
  ELSE
    v_new_liked_by := ARRAY_APPEND(COALESCE(v_liked_by, ARRAY[]::UUID[]), p_user_id);
  END IF;

  UPDATE public.posts
  SET liked_by = v_new_liked_by
  WHERE id = p_post_id;

  RETURN jsonb_build_object(
    'is_liked', NOT v_is_liked,
    'likes_count', CARDINALITY(v_new_liked_by),
    'liked_by', v_new_liked_by
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.tr_update_post_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  target_post_id UUID;
  actual_count INT;
BEGIN
  target_post_id := COALESCE(NEW.post_id, OLD.post_id);
  IF target_post_id IS NOT NULL THEN
    SELECT COUNT(*) INTO actual_count FROM public.comments WHERE post_id = target_post_id;
    UPDATE public.posts SET comment_count = actual_count WHERE id = target_post_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trigger_cleanup_typing_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- Clean up old entries when new ones are inserted
  PERFORM cleanup_old_typing_status();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_business_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  avg_rating NUMERIC;
  cnt INTEGER;
BEGIN
  SELECT AVG(rating), COUNT(*)
  INTO avg_rating, cnt
  FROM business_reviews
  WHERE business_id = COALESCE(NEW.business_id, OLD.business_id);

  UPDATE businesses
  SET
    rating = ROUND(avg_rating::NUMERIC, 2),
    review_count = cnt
  WHERE id = COALESCE(NEW.business_id, OLD.business_id);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_business_staff_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.update_comment_like_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.comments
        SET like_count = like_count + 1
        WHERE id = NEW.comment_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.comments
        SET like_count = like_count - 1
        WHERE id = OLD.comment_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Update the conversation's last message info
    UPDATE public.conversations
    SET 
        last_message_id = NEW.id,
        last_message_text = NEW.text,
        last_message_sender_id = NEW.sender_id,
        last_message_timestamp = NEW.timestamp,
        updated_at = NOW()
    WHERE id = NEW.conversation_id;
    
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_notifications_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_quote_requests_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.update_seller_rating()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  avg_rating NUMERIC;
  cnt INTEGER;
BEGIN
  SELECT AVG(rating), COUNT(*)
  INTO avg_rating, cnt
  FROM user_reviews
  WHERE seller_id = COALESCE(NEW.seller_id, OLD.seller_id);

  UPDATE users
  SET
    rating = ROUND(avg_rating::NUMERIC, 1),
    review_count = cnt
  WHERE id = COALESCE(NEW.seller_id, OLD.seller_id);

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_location(user_id uuid, latitude numeric, longitude numeric, address text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.users 
  SET 
    current_location = jsonb_build_object(
      'lat', latitude,
      'lng', longitude,
      'address', address,
      'last_updated', NOW()
    ),
    location_updated_at = NOW()
  WHERE id = user_id;
END;
$function$;

CREATE OR REPLACE VIEW public.notification_stats WITH (security_invoker=true) AS  SELECT user_id,
    count(*) AS total_notifications,
    count(*) FILTER (WHERE is_read = false) AS unread_count,
    count(*) FILTER (WHERE created_at > (now() - '24:00:00'::interval)) AS today_count,
    count(*) FILTER (WHERE created_at > (now() - '7 days'::interval)) AS week_count
   FROM notifications
  GROUP BY user_id;;

CREATE OR REPLACE VIEW public.public_profiles WITH (security_invoker=false) AS  SELECT id,
    name,
    username,
    avatar_url,
    bio,
    interests,
    created_at,
    updated_at,
    home_state,
    home_lga,
    verified_seller,
    phone_verified,
    rating,
    review_count,
    discoverable,
    is_online,
    last_seen,
    jsonb_build_object('state', home_state, 'lga', home_lga) AS location,
    COALESCE(cardinality(friends), 0) AS friend_count
   FROM users;;

ALTER TABLE public.admin_sessions ADD CONSTRAINT admin_sessions_pkey PRIMARY KEY (id);

ALTER TABLE public.admin_sessions ADD CONSTRAINT admin_sessions_session_token_key UNIQUE (session_token);

ALTER TABLE public.alerts ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);

ALTER TABLE public.availability_exceptions ADD CONSTRAINT availability_exceptions_pkey PRIMARY KEY (id);

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_amount_check CHECK (amount >= 0::numeric);

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_payluk_reference_key UNIQUE (payluk_reference);

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_pkey PRIMARY KEY (id);

ALTER TABLE public.bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);

ALTER TABLE public.business_favorites ADD CONSTRAINT business_favorites_business_id_user_id_key UNIQUE (business_id, user_id);

ALTER TABLE public.business_favorites ADD CONSTRAINT business_favorites_pkey PRIMARY KEY (id);

ALTER TABLE public.business_messages ADD CONSTRAINT business_messages_pkey PRIMARY KEY (id);

ALTER TABLE public.business_reviews ADD CONSTRAINT business_reviews_booking_id_key UNIQUE (booking_id);

ALTER TABLE public.business_reviews ADD CONSTRAINT business_reviews_pkey PRIMARY KEY (id);

ALTER TABLE public.business_reviews ADD CONSTRAINT business_reviews_rating_check CHECK (rating >= 1 AND rating <= 5);

ALTER TABLE public.business_reviews ADD CONSTRAINT check_verified_purchase CHECK (transaction_id IS NULL OR verified_purchase = true);

ALTER TABLE public.business_staff ADD CONSTRAINT business_staff_pkey PRIMARY KEY (id);

ALTER TABLE public.businesses ADD CONSTRAINT businesses_moderation_status_check CHECK (moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'moderation_error'::text]));

ALTER TABLE public.businesses ADD CONSTRAINT businesses_pkey PRIMARY KEY (id);

ALTER TABLE public.catalog_items ADD CONSTRAINT catalog_items_moderation_status_check CHECK (moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'moderation_error'::text]));

ALTER TABLE public.catalog_items ADD CONSTRAINT catalog_items_pkey PRIMARY KEY (id);

ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_message_type_check CHECK (message_type = ANY (ARRAY['text'::text, 'image'::text, 'system'::text]));

ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_pkey PRIMARY KEY (comment_id, user_id);

ALTER TABLE public.comment_reports ADD CONSTRAINT comment_reports_pkey PRIMARY KEY (id);

ALTER TABLE public.comments ADD CONSTRAINT comments_pkey PRIMARY KEY (id);

ALTER TABLE public.communities ADD CONSTRAINT communities_approval_status_check CHECK (approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));

ALTER TABLE public.communities ADD CONSTRAINT communities_pkey PRIMARY KEY (id);

ALTER TABLE public.communities ADD CONSTRAINT communities_privacy_check CHECK (privacy = ANY (ARRAY['open'::text, 'request'::text, 'invite'::text]));

ALTER TABLE public.communities ADD CONSTRAINT communities_slug_key UNIQUE (slug);

ALTER TABLE public.communities ADD CONSTRAINT communities_type_check CHECK (type = ANY (ARRAY['ward'::text, 'lga'::text, 'interest'::text]));

ALTER TABLE public.community_comment_likes ADD CONSTRAINT community_comment_likes_pkey PRIMARY KEY (comment_id, user_id);

ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_moderation_status_check CHECK (moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'moderation_error'::text]));

ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_pkey PRIMARY KEY (id);

ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_community_id_invited_user_id_key UNIQUE (community_id, invited_user_id);

ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_pkey PRIMARY KEY (id);

ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_status_check CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]));

ALTER TABLE public.community_join_requests ADD CONSTRAINT community_join_requests_community_id_user_id_key UNIQUE (community_id, user_id);

ALTER TABLE public.community_join_requests ADD CONSTRAINT community_join_requests_pkey PRIMARY KEY (id);

ALTER TABLE public.community_join_requests ADD CONSTRAINT community_join_requests_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));

ALTER TABLE public.community_memberships ADD CONSTRAINT community_memberships_community_id_user_id_key UNIQUE (community_id, user_id);

ALTER TABLE public.community_memberships ADD CONSTRAINT community_memberships_pkey PRIMARY KEY (id);

ALTER TABLE public.community_memberships ADD CONSTRAINT community_memberships_role_check CHECK (role = ANY (ARRAY['member'::text, 'moderator'::text, 'admin'::text]));

ALTER TABLE public.community_memberships ADD CONSTRAINT community_memberships_status_check CHECK (status = ANY (ARRAY['active'::text, 'pending'::text, 'banned'::text]));

ALTER TABLE public.community_post_likes ADD CONSTRAINT community_post_likes_pkey PRIMARY KEY (post_id, user_id);

ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_moderation_status_check CHECK (moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'moderation_error'::text]));

ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_pkey PRIMARY KEY (id);

ALTER TABLE public.conversations ADD CONSTRAINT conversations_invite_code_key UNIQUE (invite_code);

ALTER TABLE public.conversations ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);

ALTER TABLE public.conversations ADD CONSTRAINT conversations_type_check CHECK (type = ANY (ARRAY['friend'::text, 'marketplace'::text, 'business'::text, 'briefcase'::text, 'event'::text, 'group'::text]));

ALTER TABLE public.dispute_resolution_operations ADD CONSTRAINT dispute_resolution_operations_dispute_id_key UNIQUE (dispute_id);

ALTER TABLE public.dispute_resolution_operations ADD CONSTRAINT dispute_resolution_operations_pkey PRIMARY KEY (id);

ALTER TABLE public.dispute_resolution_operations ADD CONSTRAINT dispute_resolution_operations_refund_amount_check CHECK (refund_amount >= 0::numeric);

ALTER TABLE public.dispute_resolution_operations ADD CONSTRAINT dispute_resolution_operations_seller_amount_check CHECK (seller_amount >= 0::numeric);

ALTER TABLE public.dispute_resolution_operations ADD CONSTRAINT dispute_resolution_operations_status_check CHECK (status = ANY (ARRAY['processing'::text, 'succeeded'::text, 'needs_reconciliation'::text, 'retryable'::text]));

ALTER TABLE public.disputes ADD CONSTRAINT disputes_pkey PRIMARY KEY (id);

ALTER TABLE public.disputes ADD CONSTRAINT disputes_provider_seller_reply_status_check CHECK (provider_seller_reply_status = ANY (ARRAY['not_required'::text, 'processing'::text, 'submitted'::text, 'needs_reconciliation'::text]));

ALTER TABLE public.disputes ADD CONSTRAINT disputes_provider_submission_status_check CHECK (provider_submission_status = ANY (ARRAY['not_required'::text, 'processing'::text, 'submitted'::text, 'needs_reconciliation'::text]));

ALTER TABLE public.disputes ADD CONSTRAINT disputes_status_check CHECK (status = ANY (ARRAY['open'::text, 'under_review'::text, 'resolved'::text, 'closed'::text]));

ALTER TABLE public.escrow_transactions ADD CONSTRAINT escrow_transactions_pkey PRIMARY KEY (id);

ALTER TABLE public.event_bookmarks ADD CONSTRAINT event_bookmarks_pkey PRIMARY KEY (id);

ALTER TABLE public.event_bookmarks ADD CONSTRAINT event_bookmarks_user_id_event_id_key UNIQUE (user_id, event_id);

ALTER TABLE public.event_payouts ADD CONSTRAINT event_payouts_payment_provider_check CHECK (payment_provider = ANY (ARRAY['payluk'::text, 'paystack'::text]));

ALTER TABLE public.event_payouts ADD CONSTRAINT event_payouts_pkey PRIMARY KEY (id);

ALTER TABLE public.event_payouts ADD CONSTRAINT event_payouts_status_check CHECK (status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'COMPLETED'::text, 'FAILED'::text]));

ALTER TABLE public.events ADD CONSTRAINT events_moderation_status_check CHECK (moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'moderation_error'::text]));

ALTER TABLE public.events ADD CONSTRAINT events_payout_mode_check CHECK (payout_mode = ANY (ARRAY['INSTANT'::text, 'POST_EVENT'::text]));

ALTER TABLE public.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);

ALTER TABLE public.events ADD CONSTRAINT events_status_check CHECK (status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'CANCELLED'::text, 'COMPLETED'::text]));

ALTER TABLE public.events ADD CONSTRAINT events_visibility_check CHECK (visibility = ANY (ARRAY['PUBLIC'::text, 'WARD_ONLY'::text, 'LGA_ONLY'::text, 'UNLISTED'::text]));

ALTER TABLE public.followers ADD CONSTRAINT followers_follower_id_following_id_key UNIQUE (follower_id, following_id);

ALTER TABLE public.followers ADD CONSTRAINT followers_pkey PRIMARY KEY (id);

ALTER TABLE public.friend_requests ADD CONSTRAINT check_no_self_friend_requests CHECK (from_user_id <> to_user_id);

ALTER TABLE public.friend_requests ADD CONSTRAINT friend_requests_from_user_id_to_user_id_key UNIQUE (from_user_id, to_user_id);

ALTER TABLE public.friend_requests ADD CONSTRAINT friend_requests_pkey PRIMARY KEY (id);

ALTER TABLE public.friend_requests ADD CONSTRAINT friend_requests_status_check CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]));

ALTER TABLE public.item_chats ADD CONSTRAINT item_chats_pkey PRIMARY KEY (id);

ALTER TABLE public.lga_wards ADD CONSTRAINT lga_wards_pkey PRIMARY KEY (id);

ALTER TABLE public.lga_wards ADD CONSTRAINT lga_wards_state_lga_ward_key UNIQUE (state, lga, ward);

ALTER TABLE public.marketing_rate_limits ADD CONSTRAINT marketing_rate_limits_pkey PRIMARY KEY (id);

ALTER TABLE public.messages ADD CONSTRAINT messages_media_type_check CHECK (media_type = ANY (ARRAY['image'::text, 'video'::text]));

ALTER TABLE public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

ALTER TABLE public.moderation_queue ADD CONSTRAINT moderation_queue_pkey PRIMARY KEY (id);

ALTER TABLE public.moderation_queue ADD CONSTRAINT moderation_queue_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'moderation_error'::text]));

ALTER TABLE public.moderation_queue ADD CONSTRAINT moderation_queue_table_name_check CHECK (table_name = ANY (ARRAY['posts'::text, 'events'::text, 'businesses'::text, 'catalog_items'::text, 'users'::text, 'community_posts'::text, 'community_comments'::text]));

ALTER TABLE public.my_tickets ADD CONSTRAINT my_tickets_pkey PRIMARY KEY (id);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type = ANY (ARRAY['friend_request'::text, 'friend_request_accepted'::text, 'friend_request_declined'::text, 'message'::text, 'message_reaction'::text, 'post_like'::text, 'post_comment'::text, 'post_share'::text, 'event_invite'::text, 'event_reminder'::text, 'event_cancelled'::text, 'event_updated'::text, 'marketplace_item_sold'::text, 'marketplace_item_interest'::text, 'marketplace_message'::text, 'community_update'::text, 'system_announcement'::text, 'welcome'::text, 'profile_view'::text, 'mention'::text, 'payment_successful'::text, 'item_shipped'::text, 'delivery_confirmed'::text, 'funds_released'::text, 'dispute_opened'::text, 'dispute_resolved'::text, 'payout_processed'::text, 'payout_failed'::text, 'catalog_item_inquiry'::text, 'business_review_received'::text, 'catalog_item_out_of_stock'::text, 'new_follower'::text]));

ALTER TABLE public.payment_reconciliation_flags ADD CONSTRAINT payment_reconciliation_flags_pkey PRIMARY KEY (id);

ALTER TABLE public.payment_reconciliation_flags ADD CONSTRAINT payment_reconciliation_flags_provider_reference_reason_key UNIQUE (provider, reference, reason);

ALTER TABLE public.payment_reconciliation_flags ADD CONSTRAINT payment_reconciliation_flags_status_check CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text]));

ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_payment_provider_check CHECK (payment_provider = ANY (ARRAY['payluk'::text, 'paystack'::text]));

ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_pkey PRIMARY KEY (id);

ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_status_check CHECK (status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text]));

ALTER TABLE public.post_bookmarks ADD CONSTRAINT post_bookmarks_pkey PRIMARY KEY (id);

ALTER TABLE public.post_bookmarks ADD CONSTRAINT post_bookmarks_user_id_post_id_key UNIQUE (user_id, post_id);

ALTER TABLE public.post_reports ADD CONSTRAINT post_reports_pkey PRIMARY KEY (id);

ALTER TABLE public.posts ADD CONSTRAINT chk_sold_item_fields CHECK (is_sold = false OR is_sold = true AND sold_to_user_id IS NOT NULL AND sold_at IS NOT NULL AND transaction_id IS NOT NULL);

ALTER TABLE public.posts ADD CONSTRAINT posts_moderation_status_check CHECK (moderation_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'moderation_error'::text]));

ALTER TABLE public.posts ADD CONSTRAINT posts_pkey PRIMARY KEY (id);

ALTER TABLE public.provider_availability ADD CONSTRAINT chk_availability_times CHECK (start_time < end_time);

ALTER TABLE public.provider_availability ADD CONSTRAINT provider_availability_day_of_week_check CHECK (day_of_week >= 0 AND day_of_week <= 6);

ALTER TABLE public.provider_availability ADD CONSTRAINT provider_availability_pkey PRIMARY KEY (id);

ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE public.quote_messages ADD CONSTRAINT quote_messages_pkey PRIMARY KEY (id);

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_converted_booking_id_key UNIQUE (converted_booking_id);

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_pkey PRIMARY KEY (id);

ALTER TABLE public.rate_limits ADD CONSTRAINT rate_limits_user_endpoint_key UNIQUE (user_id, endpoint);

ALTER TABLE public.reports ADD CONSTRAINT reports_pkey PRIMARY KEY (id);

ALTER TABLE public.safety_alerts ADD CONSTRAINT safety_alerts_pkey PRIMARY KEY (id);

ALTER TABLE public.safety_alerts ADD CONSTRAINT safety_alerts_severity_check CHECK (severity = ANY (ARRAY['information'::text, 'caution'::text, 'urgent'::text]));

ALTER TABLE public.safety_alerts ADD CONSTRAINT safety_alerts_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));

ALTER TABLE public.safety_alerts ADD CONSTRAINT safety_alerts_type_check CHECK (type = ANY (ARRAY['safety'::text, 'amber'::text, 'info'::text]));

ALTER TABLE public.seller_accounts ADD CONSTRAINT seller_accounts_pkey PRIMARY KEY (id);

ALTER TABLE public.service_offerings ADD CONSTRAINT service_offerings_deposit_percent_check CHECK (deposit_percent IS NULL OR deposit_percent >= 0 AND deposit_percent <= 100);

ALTER TABLE public.service_offerings ADD CONSTRAINT service_offerings_duration_minutes_check CHECK (duration_minutes > 0);

ALTER TABLE public.service_offerings ADD CONSTRAINT service_offerings_pkey PRIMARY KEY (id);

ALTER TABLE public.service_staff_assignments ADD CONSTRAINT service_staff_assignments_pkey PRIMARY KEY (service_id, staff_id);

ALTER TABLE public.sms_delivery_logs ADD CONSTRAINT sms_delivery_logs_pkey PRIMARY KEY (id);

ALTER TABLE public.strike_appeals ADD CONSTRAINT strike_appeals_appellant_type_check CHECK (appellant_type = ANY (ARRAY['customer'::text, 'provider'::text]));

ALTER TABLE public.strike_appeals ADD CONSTRAINT strike_appeals_pkey PRIMARY KEY (id);

ALTER TABLE public.strike_appeals ADD CONSTRAINT strike_appeals_status_check CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]));

ALTER TABLE public.ticket_tiers ADD CONSTRAINT ticket_tiers_pkey PRIMARY KEY (id);

ALTER TABLE public.ticket_tiers ADD CONSTRAINT ticket_tiers_price_check CHECK (price >= 0::numeric);

ALTER TABLE public.tickets ADD CONSTRAINT tickets_payment_provider_check CHECK (payment_provider = ANY (ARRAY['payluk'::text, 'paystack'::text]));

ALTER TABLE public.tickets ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);

ALTER TABLE public.tickets ADD CONSTRAINT tickets_refund_status_launch_check CHECK (refund_status IS NULL OR (refund_status = ANY (ARRAY['initiating'::text, 'pending'::text, 'processing'::text, 'needs-attention'::text, 'failed'::text, 'processed'::text])));

ALTER TABLE public.tickets ADD CONSTRAINT tickets_settlement_mode_check CHECK (settlement_mode = ANY (ARRAY['unknown'::text, 'held'::text, 'split'::text, 'free'::text]));

ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_check CHECK (status = ANY (ARRAY['PAID'::text, 'USED'::text, 'REFUNDED'::text, 'CANCELLED'::text]));

ALTER TABLE public.tickets ADD CONSTRAINT tickets_ticket_code_key UNIQUE (ticket_code);

ALTER TABLE public.transactions ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);

ALTER TABLE public.transactions ADD CONSTRAINT transactions_tx_ref_key UNIQUE (tx_ref);

ALTER TABLE public.typing_status ADD CONSTRAINT typing_status_conversation_id_user_id_key UNIQUE (conversation_id, user_id);

ALTER TABLE public.typing_status ADD CONSTRAINT typing_status_pkey PRIMARY KEY (id);

ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_blocker_id_blocked_id_key UNIQUE (blocker_id, blocked_id);

ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (id);

ALTER TABLE public.user_push_tokens ADD CONSTRAINT user_device_unique UNIQUE (user_id, device_id);

ALTER TABLE public.user_push_tokens ADD CONSTRAINT user_push_tokens_pkey PRIMARY KEY (id);

ALTER TABLE public.user_reviews ADD CONSTRAINT user_reviews_buyer_id_transaction_id_key UNIQUE (buyer_id, transaction_id);

ALTER TABLE public.user_reviews ADD CONSTRAINT user_reviews_pkey PRIMARY KEY (id);

ALTER TABLE public.user_reviews ADD CONSTRAINT user_reviews_rating_check CHECK (rating >= 1 AND rating <= 5);

ALTER TABLE public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE public.users ADD CONSTRAINT users_username_key UNIQUE (username);

ALTER TABLE public.verification_documents ADD CONSTRAINT verification_documents_document_type_check CHECK (document_type = ANY (ARRAY['government_id'::text, 'utility_bill'::text, 'bank_statement'::text]));

ALTER TABLE public.verification_documents ADD CONSTRAINT verification_documents_pkey PRIMARY KEY (id);

ALTER TABLE public.alerts ADD CONSTRAINT alerts_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id);

ALTER TABLE public.availability_exceptions ADD CONSTRAINT availability_exceptions_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.availability_exceptions ADD CONSTRAINT availability_exceptions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES business_staff(id) ON DELETE CASCADE;

ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES users(id);

ALTER TABLE public.bookings ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE SET NULL;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_service_id_fkey FOREIGN KEY (service_id) REFERENCES service_offerings(id) ON DELETE RESTRICT;

ALTER TABLE public.bookings ADD CONSTRAINT bookings_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES business_staff(id) ON DELETE SET NULL;

ALTER TABLE public.business_favorites ADD CONSTRAINT business_favorites_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.business_favorites ADD CONSTRAINT business_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.business_messages ADD CONSTRAINT business_messages_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.business_messages ADD CONSTRAINT business_messages_item_id_fkey FOREIGN KEY (item_id) REFERENCES catalog_items(id) ON DELETE CASCADE;

ALTER TABLE public.business_messages ADD CONSTRAINT business_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.business_reviews ADD CONSTRAINT business_reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;

ALTER TABLE public.business_reviews ADD CONSTRAINT business_reviews_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.business_reviews ADD CONSTRAINT business_reviews_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES escrow_transactions(id) ON DELETE SET NULL;

ALTER TABLE public.business_reviews ADD CONSTRAINT business_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.business_staff ADD CONSTRAINT business_staff_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.business_staff ADD CONSTRAINT business_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.businesses ADD CONSTRAINT businesses_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.catalog_items ADD CONSTRAINT catalog_items_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.catalog_items ADD CONSTRAINT catalog_items_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES escrow_transactions(id);

ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES item_chats(id) ON DELETE CASCADE;

ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE;

ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.comment_reports ADD CONSTRAINT comment_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.comments ADD CONSTRAINT comments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE;

ALTER TABLE public.comments ADD CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE public.comments ADD CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.communities ADD CONSTRAINT communities_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.communities ADD CONSTRAINT communities_parent_community_id_fkey FOREIGN KEY (parent_community_id) REFERENCES communities(id) ON DELETE SET NULL;

ALTER TABLE public.communities ADD CONSTRAINT communities_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.communities ADD CONSTRAINT communities_ward_id_fkey FOREIGN KEY (ward_id) REFERENCES lga_wards(id) ON DELETE SET NULL;

ALTER TABLE public.community_comment_likes ADD CONSTRAINT community_comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES community_comments(id) ON DELETE CASCADE;

ALTER TABLE public.community_comment_likes ADD CONSTRAINT community_comment_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES community_comments(id) ON DELETE CASCADE;

ALTER TABLE public.community_comments ADD CONSTRAINT community_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE;

ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES users(id);

ALTER TABLE public.community_invites ADD CONSTRAINT community_invites_invited_user_id_fkey FOREIGN KEY (invited_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.community_join_requests ADD CONSTRAINT community_join_requests_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE public.community_join_requests ADD CONSTRAINT community_join_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id);

ALTER TABLE public.community_join_requests ADD CONSTRAINT community_join_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.community_memberships ADD CONSTRAINT community_memberships_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE public.community_memberships ADD CONSTRAINT community_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.community_post_likes ADD CONSTRAINT community_post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE;

ALTER TABLE public.community_post_likes ADD CONSTRAINT community_post_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.community_posts ADD CONSTRAINT community_posts_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE;

ALTER TABLE public.conversations ADD CONSTRAINT conversations_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.conversations ADD CONSTRAINT conversations_item_id_fkey FOREIGN KEY (item_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE public.conversations ADD CONSTRAINT conversations_last_message_sender_id_fkey FOREIGN KEY (last_message_sender_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.conversations ADD CONSTRAINT fk_conversations_business_id FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.dispute_resolution_operations ADD CONSTRAINT dispute_resolution_operations_dispute_id_fkey FOREIGN KEY (dispute_id) REFERENCES disputes(id) ON DELETE RESTRICT;

ALTER TABLE public.dispute_resolution_operations ADD CONSTRAINT dispute_resolution_operations_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES users(id);

ALTER TABLE public.disputes ADD CONSTRAINT disputes_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.disputes ADD CONSTRAINT disputes_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES users(id);

ALTER TABLE public.disputes ADD CONSTRAINT disputes_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES escrow_transactions(id) ON DELETE CASCADE;

ALTER TABLE public.escrow_transactions ADD CONSTRAINT escrow_transactions_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.escrow_transactions ADD CONSTRAINT escrow_transactions_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.event_bookmarks ADD CONSTRAINT event_bookmarks_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE public.event_bookmarks ADD CONSTRAINT event_bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.event_payouts ADD CONSTRAINT event_payouts_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE public.event_payouts ADD CONSTRAINT event_payouts_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.events ADD CONSTRAINT events_organizer_id_fkey FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.followers ADD CONSTRAINT followers_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.followers ADD CONSTRAINT followers_following_id_fkey FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.friend_requests ADD CONSTRAINT friend_requests_from_user_id_fkey FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.friend_requests ADD CONSTRAINT friend_requests_to_user_id_fkey FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.item_chats ADD CONSTRAINT item_chats_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.item_chats ADD CONSTRAINT item_chats_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.messages ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

ALTER TABLE public.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.moderation_queue ADD CONSTRAINT moderation_queue_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES users(id);

ALTER TABLE public.moderation_queue ADD CONSTRAINT moderation_queue_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.my_tickets ADD CONSTRAINT my_tickets_event_id_fkey FOREIGN KEY (event_id) REFERENCES posts(id);

ALTER TABLE public.my_tickets ADD CONSTRAINT my_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE public.notifications ADD CONSTRAINT notifications_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.payment_reconciliation_flags ADD CONSTRAINT payment_reconciliation_flags_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES escrow_transactions(id);

ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_account_id_fkey FOREIGN KEY (account_id) REFERENCES seller_accounts(id) ON DELETE CASCADE;

ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.post_bookmarks ADD CONSTRAINT post_bookmarks_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE public.post_bookmarks ADD CONSTRAINT post_bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.post_reports ADD CONSTRAINT post_reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.posts ADD CONSTRAINT posts_sold_to_user_id_fkey FOREIGN KEY (sold_to_user_id) REFERENCES users(id);

ALTER TABLE public.posts ADD CONSTRAINT posts_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES escrow_transactions(id);

ALTER TABLE public.posts ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.provider_availability ADD CONSTRAINT provider_availability_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.provider_availability ADD CONSTRAINT provider_availability_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES business_staff(id) ON DELETE CASCADE;

ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.quote_messages ADD CONSTRAINT quote_messages_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quote_requests(id) ON DELETE CASCADE;

ALTER TABLE public.quote_messages ADD CONSTRAINT quote_messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_converted_booking_id_fkey FOREIGN KEY (converted_booking_id) REFERENCES bookings(id) ON DELETE SET NULL;

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.quote_requests ADD CONSTRAINT quote_requests_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES business_staff(id) ON DELETE SET NULL;

ALTER TABLE public.rate_limits ADD CONSTRAINT rate_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.reports ADD CONSTRAINT reports_reported_post_id_fkey FOREIGN KEY (reported_post_id) REFERENCES posts(id) ON DELETE CASCADE;

ALTER TABLE public.reports ADD CONSTRAINT reports_reported_user_id_fkey FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.reports ADD CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.reports ADD CONSTRAINT reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.safety_alerts ADD CONSTRAINT safety_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.seller_accounts ADD CONSTRAINT seller_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.service_offerings ADD CONSTRAINT service_offerings_business_id_fkey FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;

ALTER TABLE public.service_staff_assignments ADD CONSTRAINT service_staff_assignments_service_id_fkey FOREIGN KEY (service_id) REFERENCES service_offerings(id) ON DELETE CASCADE;

ALTER TABLE public.service_staff_assignments ADD CONSTRAINT service_staff_assignments_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES business_staff(id) ON DELETE CASCADE;

ALTER TABLE public.strike_appeals ADD CONSTRAINT strike_appeals_appellant_id_fkey FOREIGN KEY (appellant_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.strike_appeals ADD CONSTRAINT strike_appeals_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;

ALTER TABLE public.strike_appeals ADD CONSTRAINT strike_appeals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE public.ticket_tiers ADD CONSTRAINT ticket_tiers_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE public.tickets ADD CONSTRAINT tickets_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.tickets ADD CONSTRAINT tickets_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

ALTER TABLE public.tickets ADD CONSTRAINT tickets_scanned_by_fkey FOREIGN KEY (scanned_by) REFERENCES users(id);

ALTER TABLE public.tickets ADD CONSTRAINT tickets_tier_id_fkey FOREIGN KEY (tier_id) REFERENCES ticket_tiers(id) ON DELETE CASCADE;

ALTER TABLE public.transactions ADD CONSTRAINT transactions_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id);

ALTER TABLE public.transactions ADD CONSTRAINT transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE public.typing_status ADD CONSTRAINT typing_status_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;

ALTER TABLE public.typing_status ADD CONSTRAINT typing_status_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.user_blocks ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.user_push_tokens ADD CONSTRAINT user_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.user_reviews ADD CONSTRAINT user_reviews_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.user_reviews ADD CONSTRAINT user_reviews_seller_id_fkey FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE public.user_reviews ADD CONSTRAINT user_reviews_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES escrow_transactions(id) ON DELETE SET NULL;

ALTER TABLE public.users ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.verification_documents ADD CONSTRAINT verification_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX booking_payments_payluk_escrow_id_key ON public.booking_payments USING btree (payluk_escrow_id) WHERE (payluk_escrow_id IS NOT NULL);

CREATE UNIQUE INDEX booking_payments_payluk_payment_token_key ON public.booking_payments USING btree (payluk_payment_token) WHERE (payluk_payment_token IS NOT NULL);

CREATE UNIQUE INDEX business_reviews_one_per_user_per_business ON public.business_reviews USING btree (business_id, user_id);

CREATE UNIQUE INDEX disputes_one_per_transaction ON public.disputes USING btree (transaction_id);

CREATE INDEX idx_availability_exceptions_staff_id ON public.availability_exceptions USING btree (staff_id) WHERE (staff_id IS NOT NULL);

CREATE INDEX idx_booking_payments_booking_id ON public.booking_payments USING btree (booking_id);

CREATE INDEX idx_booking_payments_payluk_reference ON public.booking_payments USING btree (payluk_reference) WHERE (payluk_reference IS NOT NULL);

CREATE INDEX idx_bookings_business ON public.bookings USING btree (business_id, status, appointment_time);

CREATE INDEX idx_bookings_customer ON public.bookings USING btree (customer_id, status);

CREATE INDEX idx_bookings_quote_id ON public.bookings USING btree (quote_id) WHERE (quote_id IS NOT NULL);

CREATE INDEX idx_bookings_reminders ON public.bookings USING btree (status, appointment_time) WHERE (status = 'confirmed'::booking_status);

CREATE INDEX idx_bookings_staff_id ON public.bookings USING btree (staff_id) WHERE (staff_id IS NOT NULL);

CREATE INDEX idx_business_messages_business_id ON public.business_messages USING btree (business_id);

CREATE INDEX idx_business_messages_item_id ON public.business_messages USING btree (item_id);

CREATE INDEX idx_business_messages_sender_id ON public.business_messages USING btree (sender_id);

CREATE INDEX idx_business_reviews_business_id ON public.business_reviews USING btree (business_id);

CREATE INDEX idx_business_reviews_transaction_id ON public.business_reviews USING btree (transaction_id);

CREATE INDEX idx_business_reviews_user_id ON public.business_reviews USING btree (user_id);

CREATE INDEX idx_business_staff_business_id ON public.business_staff USING btree (business_id);

CREATE INDEX idx_business_staff_user_id ON public.business_staff USING btree (user_id) WHERE (user_id IS NOT NULL);

CREATE INDEX idx_businesses_admin_location_composite ON public.businesses USING btree (((admin_location ->> 'state'::text)), ((admin_location ->> 'lga'::text)), ((admin_location ->> 'ward'::text))) WHERE (admin_location IS NOT NULL);

CREATE INDEX idx_businesses_admin_location_lga ON public.businesses USING btree (((admin_location ->> 'lga'::text))) WHERE (admin_location IS NOT NULL);

CREATE INDEX idx_businesses_admin_location_state ON public.businesses USING btree (((admin_location ->> 'state'::text))) WHERE (admin_location IS NOT NULL);

CREATE INDEX idx_businesses_admin_location_ward ON public.businesses USING btree (((admin_location ->> 'ward'::text))) WHERE (admin_location IS NOT NULL);

CREATE INDEX idx_businesses_category ON public.businesses USING btree (category);

CREATE INDEX idx_businesses_created_at ON public.businesses USING btree (created_at DESC);

CREATE INDEX idx_businesses_image_urls ON public.businesses USING gin (image_urls);

CREATE INDEX idx_businesses_lga ON public.businesses USING btree (lga);

CREATE INDEX idx_businesses_location ON public.businesses USING gin (location);

CREATE INDEX idx_businesses_owner_id ON public.businesses USING btree (owner_id);

CREATE INDEX idx_businesses_state ON public.businesses USING btree (state);

CREATE INDEX idx_businesses_state_category ON public.businesses USING btree (state, category) WHERE (state IS NOT NULL);

CREATE INDEX idx_businesses_text_search ON public.businesses USING gin (to_tsvector('english'::regconfig, (((name)::text || ' '::text) || COALESCE(description, ''::text))));

CREATE INDEX idx_businesses_ward ON public.businesses USING btree (ward);

CREATE INDEX idx_catalog_items_business_id ON public.catalog_items USING btree (business_id);

CREATE INDEX idx_catalog_items_category ON public.catalog_items USING btree (category);

CREATE INDEX idx_catalog_items_images ON public.catalog_items USING gin (images);

CREATE INDEX idx_catalog_items_text_search ON public.catalog_items USING gin (to_tsvector('english'::regconfig, ((title || ' '::text) || COALESCE(description, ''::text))));

CREATE INDEX idx_chat_messages_chat_id ON public.chat_messages USING btree (chat_id);

CREATE INDEX idx_chat_messages_metadata ON public.chat_messages USING gin (metadata);

CREATE INDEX idx_chat_messages_timestamp ON public.chat_messages USING btree ("timestamp" DESC);

CREATE INDEX idx_comm_comments_parent ON public.community_comments USING btree (parent_comment_id);

CREATE INDEX idx_comm_comments_post ON public.community_comments USING btree (post_id, created_at);

CREATE INDEX idx_comm_join_requests ON public.community_join_requests USING btree (community_id, status);

CREATE INDEX idx_comm_memberships_comm ON public.community_memberships USING btree (community_id, status, role);

CREATE INDEX idx_comm_memberships_user ON public.community_memberships USING btree (user_id, status);

CREATE INDEX idx_comm_posts_author ON public.community_posts USING btree (author_id);

CREATE INDEX idx_comm_posts_feed ON public.community_posts USING btree (community_id, moderation_status, is_pinned DESC, created_at DESC);

CREATE INDEX idx_comment_reports_comment_id ON public.comment_reports USING btree (comment_id);

CREATE INDEX idx_comment_reports_reporter_id ON public.comment_reports USING btree (reporter_id);

CREATE INDEX idx_comments_parent_id ON public.comments USING btree (parent_id);

CREATE INDEX idx_comments_post_id ON public.comments USING btree (post_id);

CREATE INDEX idx_comments_post_timestamp ON public.comments USING btree (post_id, "timestamp");

CREATE INDEX idx_comments_reactions ON public.comments USING gin (reactions);

CREATE INDEX idx_comments_timestamp ON public.comments USING btree ("timestamp");

CREATE INDEX idx_comments_user_id ON public.comments USING btree (user_id);

CREATE INDEX idx_comments_user_timestamp ON public.comments USING btree (user_id, "timestamp" DESC);

CREATE INDEX idx_communities_location ON public.communities USING btree (type, state, lga, ward);

CREATE INDEX idx_communities_parent ON public.communities USING btree (parent_community_id);

CREATE INDEX idx_communities_pending_review ON public.communities USING btree (created_at DESC) WHERE (approval_status = 'pending'::text);

CREATE INDEX idx_communities_slug ON public.communities USING btree (slug);

CREATE INDEX idx_community_invites_community ON public.community_invites USING btree (community_id);

CREATE INDEX idx_community_invites_invited_user ON public.community_invites USING btree (invited_user_id);

CREATE INDEX idx_community_invites_status ON public.community_invites USING btree (status) WHERE (status = 'pending'::text);

CREATE INDEX idx_conversations_business_id ON public.conversations USING btree (business_id);

CREATE INDEX idx_conversations_invite_code ON public.conversations USING btree (invite_code) WHERE (invite_code IS NOT NULL);

CREATE INDEX idx_conversations_item_id ON public.conversations USING btree (item_id);

CREATE INDEX idx_conversations_participant_ids ON public.conversations USING gin (participant_ids);

CREATE INDEX idx_conversations_type ON public.conversations USING btree (type);

CREATE INDEX idx_conversations_updated_at ON public.conversations USING btree (updated_at DESC);

CREATE INDEX idx_disputes_created_at ON public.disputes USING btree (created_at DESC);

CREATE INDEX idx_disputes_opened_by ON public.disputes USING btree (opened_by);

CREATE INDEX idx_disputes_resolved_by ON public.disputes USING btree (resolved_by);

CREATE INDEX idx_disputes_status ON public.disputes USING btree (status);

CREATE INDEX idx_disputes_transaction_id ON public.disputes USING btree (transaction_id);

CREATE INDEX idx_escrow_buyer_id ON public.escrow_transactions USING btree (buyer_id);

CREATE INDEX idx_escrow_item_id ON public.escrow_transactions USING btree (item_id);

CREATE INDEX idx_escrow_seller_id ON public.escrow_transactions USING btree (seller_id);

CREATE INDEX idx_escrow_status ON public.escrow_transactions USING btree (status);

CREATE INDEX idx_escrow_transactions_buyer_status ON public.escrow_transactions USING btree (buyer_id, status);

CREATE INDEX idx_escrow_transactions_delivery_details ON public.escrow_transactions USING gin (delivery_details);

CREATE INDEX idx_escrow_transactions_flutterwave_ref ON public.escrow_transactions USING btree (flutterwave_tx_ref);

CREATE INDEX idx_escrow_transactions_payment_ref ON public.escrow_transactions USING btree (payment_reference);

CREATE INDEX idx_escrow_transactions_pending ON public.escrow_transactions USING btree (status, created_at DESC) WHERE (status = 'pending'::escrow_status);

CREATE INDEX idx_escrow_transactions_seller_status ON public.escrow_transactions USING btree (seller_id, status);

CREATE UNIQUE INDEX idx_escrow_transactions_single_active_catalog_buyer ON public.escrow_transactions USING btree (item_id, buyer_id) WHERE ((item_type = 'catalog_item'::text) AND (status <> ALL (ARRAY['cancelled'::escrow_status, 'completed'::escrow_status])));

CREATE UNIQUE INDEX idx_escrow_transactions_single_active_post ON public.escrow_transactions USING btree (item_id) WHERE ((COALESCE(item_type, 'post'::text) = 'post'::text) AND (status <> ALL (ARRAY['cancelled'::escrow_status, 'completed'::escrow_status])));

CREATE INDEX idx_event_payouts_event_id ON public.event_payouts USING btree (event_id);

CREATE UNIQUE INDEX idx_event_payouts_one_per_event ON public.event_payouts USING btree (event_id);

CREATE INDEX idx_event_payouts_status ON public.event_payouts USING btree (status);

CREATE INDEX idx_events_organizer_id ON public.events USING btree (organizer_id);

CREATE INDEX idx_events_start_time ON public.events USING btree (start_time);

CREATE INDEX idx_events_state_lga ON public.events USING btree (state, lga);

CREATE INDEX idx_events_status ON public.events USING btree (status);

CREATE INDEX idx_friend_requests_from_user_id ON public.friend_requests USING btree (from_user_id);

CREATE INDEX idx_friend_requests_pending ON public.friend_requests USING btree (to_user_id, created_at DESC) WHERE (status = 'pending'::text);

CREATE INDEX idx_friend_requests_status ON public.friend_requests USING btree (status);

CREATE INDEX idx_friend_requests_status_timestamp ON public.friend_requests USING btree (status, "timestamp" DESC);

CREATE INDEX idx_friend_requests_to_user_id ON public.friend_requests USING btree (to_user_id);

CREATE INDEX idx_item_chats_buyer_id ON public.item_chats USING btree (buyer_id);

CREATE INDEX idx_item_chats_item_id ON public.item_chats USING btree (item_id);

CREATE INDEX idx_item_chats_last_message_at ON public.item_chats USING btree (last_message_at DESC);

CREATE INDEX idx_item_chats_seller_id ON public.item_chats USING btree (seller_id);

CREATE INDEX idx_messages_conversation_id ON public.messages USING btree (conversation_id);

CREATE INDEX idx_messages_conversation_timestamp ON public.messages USING btree (conversation_id, "timestamp");

CREATE INDEX idx_messages_sender_id ON public.messages USING btree (sender_id);

CREATE INDEX idx_messages_sender_timestamp ON public.messages USING btree (sender_id, "timestamp" DESC);

CREATE INDEX idx_messages_timestamp ON public.messages USING btree ("timestamp");

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);

CREATE INDEX idx_notifications_data ON public.notifications USING gin (data);

CREATE INDEX idx_notifications_sender_id ON public.notifications USING btree (sender_id);

CREATE INDEX idx_notifications_type ON public.notifications USING btree (type);

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, created_at DESC) WHERE (is_read = false);

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);

CREATE INDEX idx_notifications_user_type ON public.notifications USING btree (user_id, type);

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, is_read) WHERE (is_read = false);

CREATE INDEX idx_notifications_user_unread_created ON public.notifications USING btree (user_id, is_read, created_at DESC);

CREATE UNIQUE INDEX idx_one_review_per_transaction ON public.business_reviews USING btree (transaction_id, user_id) WHERE (transaction_id IS NOT NULL);

CREATE INDEX idx_payout_requests_seller_id ON public.payout_requests USING btree (seller_id);

CREATE INDEX idx_payout_requests_status ON public.payout_requests USING btree (status);

CREATE INDEX idx_post_reports_post_id ON public.post_reports USING btree (post_id);

CREATE INDEX idx_post_reports_reporter_id ON public.post_reports USING btree (reporter_id);

CREATE INDEX idx_posts_active_events ON public.posts USING btree (category, event_date) WHERE ((category = 'Event'::post_category) AND (event_date IS NOT NULL));

CREATE INDEX idx_posts_attendees ON public.posts USING gin (attendees);

CREATE INDEX idx_posts_author_location_lga ON public.posts USING btree (((author_location ->> 'lga'::text)));

CREATE INDEX idx_posts_author_location_state ON public.posts USING btree (((author_location ->> 'state'::text)));

CREATE INDEX idx_posts_author_location_ward ON public.posts USING btree (((author_location ->> 'ward'::text)));

CREATE INDEX idx_posts_business_posts ON public.posts USING btree (category, "timestamp" DESC) WHERE (category = 'Business'::post_category);

CREATE INDEX idx_posts_category ON public.posts USING btree (category);

CREATE INDEX idx_posts_category_timestamp ON public.posts USING btree (category, "timestamp" DESC);

CREATE INDEX idx_posts_image_urls ON public.posts USING gin (image_urls);

CREATE INDEX idx_posts_is_sold ON public.posts USING btree (is_sold);

CREATE INDEX idx_posts_liked_by ON public.posts USING gin (liked_by);

CREATE INDEX idx_posts_location_composite ON public.posts USING btree (((location ->> 'state'::text)), ((location ->> 'lga'::text)), ((location ->> 'ward'::text))) WHERE (location IS NOT NULL);

CREATE INDEX idx_posts_location_lga ON public.posts USING btree (((location ->> 'lga'::text))) WHERE (location IS NOT NULL);

CREATE INDEX idx_posts_location_state ON public.posts USING btree (((location ->> 'state'::text))) WHERE (location IS NOT NULL);

CREATE INDEX idx_posts_location_ward ON public.posts USING btree (((location ->> 'ward'::text))) WHERE (location IS NOT NULL);

CREATE INDEX idx_posts_marketplace_items ON public.posts USING btree (category, price) WHERE ((category = 'For Sale'::post_category) AND (price IS NOT NULL));

CREATE INDEX idx_posts_price ON public.posts USING btree (price) WHERE (price IS NOT NULL);

CREATE INDEX idx_posts_price_category ON public.posts USING btree (price, category) WHERE (price IS NOT NULL);

CREATE INDEX idx_posts_sold_at ON public.posts USING btree (sold_at);

CREATE INDEX idx_posts_sold_to_user_id ON public.posts USING btree (sold_to_user_id);

CREATE INDEX idx_posts_state ON public.posts USING btree (state) WHERE (state IS NOT NULL);

CREATE INDEX idx_posts_state_category ON public.posts USING btree (state, category) WHERE (state IS NOT NULL);

CREATE INDEX idx_posts_text_search ON public.posts USING gin (to_tsvector('english'::regconfig, ((text || ' '::text) || COALESCE(description, ''::text))));

CREATE INDEX idx_posts_timestamp ON public.posts USING btree ("timestamp" DESC);

CREATE INDEX idx_posts_transaction_id ON public.posts USING btree (transaction_id);

CREATE INDEX idx_posts_user_category ON public.posts USING btree (user_id, category);

CREATE INDEX idx_posts_user_id ON public.posts USING btree (user_id);

CREATE INDEX idx_provider_availability_staff_id ON public.provider_availability USING btree (staff_id) WHERE (staff_id IS NOT NULL);

CREATE INDEX idx_push_subscriptions_subscription ON public.push_subscriptions USING gin (subscription);

CREATE UNIQUE INDEX idx_push_subscriptions_user_endpoint ON public.push_subscriptions USING btree (user_id, ((subscription ->> 'endpoint'::text))) WHERE (subscription ? 'endpoint'::text);

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions USING btree (user_id);

CREATE INDEX idx_quote_messages_quote_id ON public.quote_messages USING btree (quote_id);

CREATE INDEX idx_quote_requests_business_id ON public.quote_requests USING btree (business_id);

CREATE INDEX idx_quote_requests_customer_id ON public.quote_requests USING btree (customer_id);

CREATE INDEX idx_quote_requests_status ON public.quote_requests USING btree (status);

CREATE UNIQUE INDEX idx_rate_limits_ip_endpoint ON public.rate_limits USING btree (ip_address, endpoint) WHERE ((ip_address IS NOT NULL) AND (user_id IS NULL));

CREATE INDEX idx_seller_accounts_account_details ON public.seller_accounts USING gin (account_details);

CREATE INDEX idx_seller_accounts_subaccount_id ON public.seller_accounts USING btree (flutterwave_subaccount_id);

CREATE INDEX idx_seller_accounts_user_id ON public.seller_accounts USING btree (user_id);

CREATE INDEX idx_seller_accounts_verification_data ON public.seller_accounts USING gin (verification_data);

CREATE INDEX idx_seller_accounts_verification_status ON public.seller_accounts USING btree (verification_status);

CREATE INDEX idx_service_offerings_business ON public.service_offerings USING btree (business_id) WHERE (is_active = true);

CREATE INDEX idx_service_staff_assignments_staff_id ON public.service_staff_assignments USING btree (staff_id);

CREATE INDEX idx_strike_appeals_appellant_id ON public.strike_appeals USING btree (appellant_id);

CREATE INDEX idx_strike_appeals_booking_id ON public.strike_appeals USING btree (booking_id);

CREATE INDEX idx_strike_appeals_status ON public.strike_appeals USING btree (status);

CREATE INDEX idx_ticket_tiers_event_id ON public.ticket_tiers USING btree (event_id);

CREATE INDEX idx_tickets_buyer_id ON public.tickets USING btree (buyer_id);

CREATE INDEX idx_tickets_event_id ON public.tickets USING btree (event_id);

CREATE INDEX idx_tickets_flw_tx_ref ON public.tickets USING btree (payment_tx_ref);

CREATE UNIQUE INDEX idx_tickets_payment_purchase_ordinal ON public.tickets USING btree (payment_tx_ref, purchase_ticket_index) WHERE ((payment_tx_ref IS NOT NULL) AND (purchase_ticket_index IS NOT NULL));

CREATE INDEX idx_tickets_status ON public.tickets USING btree (status);

CREATE INDEX idx_tickets_tier_id ON public.tickets USING btree (tier_id);

CREATE INDEX idx_typing_status_conversation ON public.typing_status USING btree (conversation_id);

CREATE INDEX idx_typing_status_updated ON public.typing_status USING btree (updated_at);

CREATE INDEX idx_typing_status_user ON public.typing_status USING btree (user_id);

CREATE INDEX idx_user_push_tokens_token ON public.user_push_tokens USING btree (push_token);

CREATE INDEX idx_user_push_tokens_user_id ON public.user_push_tokens USING btree (user_id);

CREATE INDEX idx_users_blocked_users ON public.users USING gin (blocked_users);

CREATE INDEX idx_users_digest_reminder ON public.users USING btree (digest_reminder_sent_at, email_reminders_enabled, last_seen);

CREATE INDEX idx_users_friends ON public.users USING gin (friends);

CREATE INDEX idx_users_home_location_geom ON public.users USING gist (home_location_geom);

CREATE INDEX idx_users_interests ON public.users USING gin (interests);

CREATE INDEX idx_users_is_online ON public.users USING btree (is_online);

CREATE INDEX idx_users_last_seen ON public.users USING btree (last_seen);

CREATE INDEX idx_users_location ON public.users USING gin (location);

CREATE INDEX idx_users_location_sharing ON public.users USING btree (share_location, location_updated_at) WHERE (share_location = true);

CREATE INDEX idx_users_onboarding_status ON public.users USING btree (onboarding_status);

CREATE INDEX idx_users_username ON public.users USING btree (username);

CREATE INDEX idx_verification_documents_status ON public.verification_documents USING btree (status);

CREATE INDEX idx_verification_documents_user_id ON public.verification_documents USING btree (user_id);

CREATE UNIQUE INDEX payout_requests_transaction_id_key ON public.payout_requests USING btree (transaction_id) WHERE (transaction_id IS NOT NULL);

CREATE UNIQUE INDEX uq_availability_exceptions_business_date_legacy ON public.availability_exceptions USING btree (business_id, date) WHERE (staff_id IS NULL);

CREATE UNIQUE INDEX uq_availability_exceptions_business_staff_date ON public.availability_exceptions USING btree (business_id, staff_id, date) WHERE (staff_id IS NOT NULL);

CREATE UNIQUE INDEX uq_friend_requests_pair ON public.friend_requests USING btree (LEAST((from_user_id)::text, (to_user_id)::text), GREATEST((from_user_id)::text, (to_user_id)::text));

CREATE UNIQUE INDEX uq_provider_availability_business_day_legacy ON public.provider_availability USING btree (business_id, day_of_week) WHERE (staff_id IS NULL);

CREATE UNIQUE INDEX uq_provider_availability_business_staff_day ON public.provider_availability USING btree (business_id, staff_id, day_of_week) WHERE (staff_id IS NOT NULL);

CREATE TRIGGER tr_guard_booking_payment_and_status BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION guard_booking_payment_and_status();

CREATE TRIGGER business_reviews_sync_seller_aggregates AFTER INSERT OR DELETE OR UPDATE ON business_reviews FOR EACH ROW EXECUTE FUNCTION sync_business_review_aggregate();

CREATE TRIGGER prevent_business_self_review BEFORE INSERT OR UPDATE OF business_id, user_id ON business_reviews FOR EACH ROW EXECUTE FUNCTION prevent_business_self_review();

CREATE TRIGGER sync_business_review_rating AFTER INSERT OR DELETE OR UPDATE ON business_reviews FOR EACH ROW EXECUTE FUNCTION sync_business_review_rating();

CREATE TRIGGER trg_update_business_rating AFTER INSERT OR DELETE OR UPDATE ON business_reviews FOR EACH ROW EXECUTE FUNCTION update_business_rating();

CREATE TRIGGER trg_business_staff_updated_at BEFORE UPDATE ON business_staff FOR EACH ROW EXECUTE FUNCTION update_business_staff_updated_at();

CREATE TRIGGER trigger_set_business_location BEFORE INSERT ON businesses FOR EACH ROW WHEN (new.admin_location IS NULL) EXECUTE FUNCTION set_business_location_from_user();

CREATE TRIGGER update_businesses_updated_at BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_chat_messages_updated_at BEFORE UPDATE ON chat_messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_comment_like_count_trigger AFTER INSERT OR DELETE ON comment_likes FOR EACH ROW EXECUTE FUNCTION update_comment_like_count();

CREATE TRIGGER tr_update_post_comment_count AFTER INSERT OR DELETE OR UPDATE OF post_id ON comments FOR EACH ROW EXECUTE FUNCTION tr_update_post_comment_count();

CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_community_owner_on_approval AFTER UPDATE OF approval_status ON communities FOR EACH ROW EXECUTE FUNCTION fn_community_owner_on_approval();

CREATE TRIGGER tr_community_comment_count AFTER INSERT OR DELETE ON community_comments FOR EACH ROW EXECUTE FUNCTION fn_community_comment_count();

CREATE TRIGGER tr_guard_community_comment BEFORE INSERT OR UPDATE ON community_comments FOR EACH ROW EXECUTE FUNCTION guard_community_content();

CREATE TRIGGER tr_queue_community_comment AFTER INSERT OR UPDATE ON community_comments FOR EACH ROW EXECUTE FUNCTION queue_community_content_for_moderation();

CREATE TRIGGER tr_community_member_count AFTER INSERT OR DELETE OR UPDATE ON community_memberships FOR EACH ROW EXECUTE FUNCTION fn_community_member_count();

CREATE TRIGGER tr_guard_community_membership_update BEFORE UPDATE ON community_memberships FOR EACH ROW EXECUTE FUNCTION guard_community_membership_update();

CREATE TRIGGER tr_community_post_rate_limit BEFORE INSERT ON community_posts FOR EACH ROW EXECUTE FUNCTION fn_check_community_post_rate_limit();

CREATE TRIGGER tr_guard_community_post BEFORE INSERT OR UPDATE ON community_posts FOR EACH ROW EXECUTE FUNCTION guard_community_content();

CREATE TRIGGER tr_queue_community_post AFTER INSERT OR UPDATE ON community_posts FOR EACH ROW EXECUTE FUNCTION queue_community_content_for_moderation();

CREATE TRIGGER update_escrow_transactions_updated_at BEFORE UPDATE ON escrow_transactions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friend_requests_updated_at BEFORE UPDATE ON friend_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_item_chats_updated_at BEFORE UPDATE ON item_chats FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_check_message_update_rules BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION check_message_update_rules();

CREATE TRIGGER tr_reset_conversation_deleted_by AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION reset_conversation_deleted_by();

CREATE TRIGGER trigger_update_conversation_last_message AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION update_conversation_last_message();

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_notifications_updated_at();

CREATE TRIGGER prevent_paid_marketplace_listing_delete BEFORE DELETE ON posts FOR EACH ROW EXECUTE FUNCTION prevent_paid_marketplace_listing_delete();

CREATE TRIGGER trigger_set_post_location BEFORE INSERT ON posts FOR EACH ROW WHEN (new.location IS NULL) EXECUTE FUNCTION set_post_location_from_user();

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_push_subscriptions_updated_at BEFORE UPDATE ON push_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_guard_quote_request_write BEFORE INSERT OR UPDATE ON quote_requests FOR EACH ROW EXECUTE FUNCTION guard_quote_request_write();

CREATE TRIGGER trg_quote_requests_updated_at BEFORE UPDATE ON quote_requests FOR EACH ROW EXECUTE FUNCTION update_quote_requests_updated_at();

CREATE TRIGGER update_seller_accounts_updated_at BEFORE UPDATE ON seller_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER tr_adjust_ticket_tier_sold BEFORE INSERT OR DELETE OR UPDATE OF status, tier_id ON tickets FOR EACH ROW EXECUTE FUNCTION adjust_ticket_tier_sold();

CREATE TRIGGER tr_guard_ticket_client_update BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION guard_ticket_client_update();

CREATE TRIGGER trg_sync_ticket_checked_in BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION sync_ticket_checked_in();

CREATE TRIGGER cleanup_typing_status_trigger AFTER INSERT ON typing_status FOR EACH STATEMENT EXECUTE FUNCTION trigger_cleanup_typing_status();

CREATE TRIGGER trg_update_seller_rating AFTER INSERT OR DELETE OR UPDATE ON user_reviews FOR EACH ROW EXECUTE FUNCTION update_seller_rating();

CREATE TRIGGER user_reviews_sync_seller_aggregates AFTER INSERT OR DELETE OR UPDATE ON user_reviews FOR EACH ROW EXECUTE FUNCTION sync_user_review_aggregate();

CREATE TRIGGER guard_suspension_fields BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION guard_suspension_fields();

CREATE TRIGGER on_phone_verified BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION handle_phone_verified();

CREATE TRIGGER tr_auto_join_ward_community AFTER INSERT OR UPDATE OF home_ward, home_lga, home_state ON users FOR EACH ROW EXECUTE FUNCTION fn_auto_join_ward_community();

CREATE TRIGGER trg_prevent_client_admin_escalation BEFORE INSERT OR UPDATE OF is_admin, role ON users FOR EACH ROW EXECUTE FUNCTION prevent_client_admin_escalation();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public."admin_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."alerts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."availability_exceptions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."booking_payments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."bookings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."business_favorites" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."business_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."business_reviews" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."business_staff" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."businesses" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."catalog_items" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."chat_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."comment_likes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."comment_reports" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."comments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."communities" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."community_comment_likes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."community_comments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."community_invites" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."community_join_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."community_memberships" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."community_post_likes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."community_posts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."conversations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."dispute_resolution_operations" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."disputes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."escrow_transactions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."event_bookmarks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."event_payouts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."followers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."friend_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."item_chats" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."lga_wards" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."marketing_rate_limits" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."moderation_queue" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."my_tickets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."notifications" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."payment_reconciliation_flags" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."payout_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."post_bookmarks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."post_reports" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."posts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."provider_availability" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."push_subscriptions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."quote_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."quote_requests" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."rate_limits" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."reports" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."safety_alerts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."seller_accounts" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."service_offerings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."service_staff_assignments" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."sms_delivery_logs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."strike_appeals" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."ticket_tiers" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."tickets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."transactions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."typing_status" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."user_blocks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."user_push_tokens" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."user_reviews" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."users" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."verification_documents" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable insert for admin sessions" ON public.admin_sessions AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));

CREATE POLICY "Enable select for admin sessions" ON public.admin_sessions AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Admins can delete alerts" ON public.alerts AS PERMISSIVE FOR DELETE TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.is_admin = true)))));

CREATE POLICY "Admins can insert alerts" ON public.alerts AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.is_admin = true)))));

CREATE POLICY "Admins can update alerts" ON public.alerts AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.is_admin = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.is_admin = true)))));

CREATE POLICY "Authenticated users can read alerts" ON public.alerts AS PERMISSIVE FOR SELECT TO authenticated USING (true);

CREATE POLICY "Owners manage availability exceptions" ON public.availability_exceptions AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.uid() IN ( SELECT businesses.owner_id
   FROM businesses
  WHERE (businesses.id = availability_exceptions.business_id))));

CREATE POLICY "Public read availability exceptions" ON public.availability_exceptions AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "customer read own payments" ON public.booking_payments AS PERMISSIVE FOR SELECT TO PUBLIC USING (((EXISTS ( SELECT 1
   FROM bookings b
  WHERE ((b.id = booking_payments.booking_id) AND (b.customer_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM (bookings b
     JOIN businesses biz ON ((biz.id = b.business_id)))
  WHERE ((b.id = booking_payments.booking_id) AND (biz.owner_id = auth.uid()))))));

CREATE POLICY "Customers and Providers update bookings" ON public.bookings AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((auth.uid() = customer_id) OR (auth.uid() IN ( SELECT businesses.owner_id
   FROM businesses
  WHERE (businesses.id = bookings.business_id)))));

CREATE POLICY "Customers create bookings" ON public.bookings AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((auth.uid() = customer_id));

CREATE POLICY "Users view own bookings as customer or provider" ON public.bookings AS PERMISSIVE FOR SELECT TO PUBLIC USING (((auth.uid() = customer_id) OR (auth.uid() IN ( SELECT businesses.owner_id
   FROM businesses
  WHERE (businesses.id = bookings.business_id)))));

CREATE POLICY "Allow authenticated delete business_favorites" ON public.business_favorites AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Allow authenticated insert business_favorites" ON public.business_favorites AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Allow public select business_favorites" ON public.business_favorites AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can create business messages" ON public.business_messages AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = sender_id));

CREATE POLICY "Users can delete their own business messages" ON public.business_messages AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = sender_id));

CREATE POLICY "Users can update their own business messages" ON public.business_messages AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = sender_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = sender_id));

CREATE POLICY "Users can view business messages they sent" ON public.business_messages AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = sender_id));

CREATE POLICY "Anyone can view business reviews" ON public.business_reviews AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can create reviews" ON public.business_reviews AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (NOT (EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = business_reviews.business_id) AND (b.owner_id = ( SELECT auth.uid() AS uid))))))));

CREATE POLICY "Users can delete their own reviews" ON public.business_reviews AS PERMISSIVE FOR DELETE TO PUBLIC USING (((( SELECT auth.uid() AS uid) = user_id) AND (created_at > (now() - '24:00:00'::interval))));

CREATE POLICY "Users can update their own reviews" ON public.business_reviews AS PERMISSIVE FOR UPDATE TO authenticated USING (((( SELECT auth.uid() AS uid) = user_id) AND (created_at > (now() - '24:00:00'::interval)))) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (created_at > (now() - '24:00:00'::interval)) AND (NOT (EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = business_reviews.business_id) AND (b.owner_id = ( SELECT auth.uid() AS uid))))))));

CREATE POLICY "owner manage staff" ON public.business_staff AS PERMISSIVE FOR ALL TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = business_staff.business_id) AND (b.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = business_staff.business_id) AND (b.owner_id = auth.uid())))));

CREATE POLICY "public read active staff" ON public.business_staff AS PERMISSIVE FOR SELECT TO PUBLIC USING ((is_active = true));

CREATE POLICY "Allow select on businesses" ON public.businesses AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can create their own businesses" ON public.businesses AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((( SELECT auth.role() AS role) = 'authenticated'::text) AND (( SELECT auth.uid() AS uid) = owner_id)));

CREATE POLICY "Users can delete their own businesses" ON public.businesses AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "Users can update their own businesses" ON public.businesses AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = owner_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = owner_id));

CREATE POLICY "Anyone can view catalog items" ON public.catalog_items AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Business owners can manage their catalog items" ON public.catalog_items AS PERMISSIVE FOR ALL TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM businesses
  WHERE ((businesses.id = catalog_items.business_id) AND (businesses.owner_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "Users can create chat messages" ON public.chat_messages AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((( SELECT auth.uid() AS uid))::text = sender_id));

CREATE POLICY "Users can read own chat messages" ON public.chat_messages AS PERMISSIVE FOR SELECT TO PUBLIC USING (((( SELECT auth.uid() AS uid))::text = sender_id));

CREATE POLICY "Users can update chat messages" ON public.chat_messages AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM item_chats
  WHERE (((item_chats.id)::text = (chat_messages.chat_id)::text) AND (((item_chats.buyer_id)::text = (( SELECT auth.uid() AS uid))::text) OR ((item_chats.seller_id)::text = (( SELECT auth.uid() AS uid))::text))))));

CREATE POLICY "Users can like comments" ON public.comment_likes AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can see all comment likes" ON public.comment_likes AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can unlike comments" ON public.comment_likes AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Admins can delete comment reports" ON public.comment_reports AS PERMISSIVE FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text))))));

CREATE POLICY "Admins can update comment reports" ON public.comment_reports AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text))))));

CREATE POLICY "Reporters and admins can view comment reports" ON public.comment_reports AS PERMISSIVE FOR SELECT TO authenticated USING (((reporter_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text)))))));

CREATE POLICY "Users can insert own comment reports" ON public.comment_reports AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((reporter_id = auth.uid()));

CREATE POLICY "Comments are readable by everyone" ON public.comments AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can create comments" ON public.comments AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can delete own comments" ON public.comments AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can update own comments" ON public.comments AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY communities_admin_insert ON public.communities AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.is_admin = true) OR (u.role = 'admin'::text))))));

CREATE POLICY communities_select ON public.communities AS PERMISSIVE FOR SELECT TO authenticated USING ((((approval_status = 'approved'::text) AND ((privacy = ANY (ARRAY['open'::text, 'request'::text])) OR (EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = communities.id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.status = 'active'::text)))))) OR (created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.is_admin = true) OR (u.role = ANY (ARRAY['admin'::text, 'moderator'::text]))))))));

CREATE POLICY communities_staff_update ON public.communities AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.is_admin = true) OR (u.role = ANY (ARRAY['admin'::text, 'moderator'::text]))))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.is_admin = true) OR (u.role = ANY (ARRAY['admin'::text, 'moderator'::text])))))));

CREATE POLICY communities_verified_submission ON public.communities AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND (type = 'interest'::text) AND (is_official = false) AND (approval_status = 'pending'::text) AND ((char_length(btrim(name)) >= 3) AND (char_length(btrim(name)) <= 60)) AND ((char_length(btrim(COALESCE(description, ''::text))) >= 1) AND (char_length(btrim(COALESCE(description, ''::text))) <= 500)) AND (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND (u.phone_verified = true))))));

CREATE POLICY comm_comment_likes_delete ON public.community_comment_likes AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY comm_comment_likes_insert ON public.community_comment_likes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM ((community_comments c
     JOIN community_posts p ON ((p.id = c.post_id)))
     JOIN community_memberships m ON ((m.community_id = c.community_id)))
  WHERE ((c.id = community_comment_likes.comment_id) AND (c.moderation_status = 'approved'::text) AND (p.moderation_status = 'approved'::text) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));

CREATE POLICY comm_comment_likes_select ON public.community_comment_likes AS PERMISSIVE FOR SELECT TO authenticated USING (true);

CREATE POLICY comm_comments_delete_author ON public.community_comments AS PERMISSIVE FOR DELETE TO authenticated USING ((author_id = auth.uid()));

CREATE POLICY comm_comments_delete_mod ON public.community_comments AS PERMISSIVE FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = community_comments.community_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['moderator'::text, 'admin'::text])) AND (m.status = 'active'::text)))));

CREATE POLICY comm_comments_insert ON public.community_comments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = community_comments.community_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));

CREATE POLICY comm_comments_select ON public.community_comments AS PERMISSIVE FOR SELECT TO authenticated USING ((((moderation_status = 'approved'::text) OR (author_id = auth.uid()) OR is_community_mod_or_admin(community_id, auth.uid())) AND (EXISTS ( SELECT 1
   FROM community_posts p
  WHERE ((p.id = community_comments.post_id) AND ((p.moderation_status = 'approved'::text) OR (p.author_id = auth.uid()) OR is_community_mod_or_admin(community_comments.community_id, auth.uid()))))) AND (EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = community_comments.community_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));

CREATE POLICY comm_comments_update_author ON public.community_comments AS PERMISSIVE FOR UPDATE TO authenticated USING ((author_id = auth.uid()));

CREATE POLICY comm_comments_update_mod ON public.community_comments AS PERMISSIVE FOR UPDATE TO authenticated USING (is_community_mod_or_admin(community_id, auth.uid()));

CREATE POLICY invites_delete_mod ON public.community_invites AS PERMISSIVE FOR DELETE TO PUBLIC USING (((invited_by = auth.uid()) OR is_community_mod_or_admin(community_id, auth.uid())));

CREATE POLICY invites_insert_mod ON public.community_invites AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((invited_by = auth.uid()) AND is_community_mod_or_admin(community_id, auth.uid())));

CREATE POLICY invites_select_visible ON public.community_invites AS PERMISSIVE FOR SELECT TO PUBLIC USING (((invited_user_id = auth.uid()) OR (invited_by = auth.uid()) OR is_community_mod_or_admin(community_id, auth.uid())));

CREATE POLICY invites_update_invited_or_mod ON public.community_invites AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((invited_user_id = auth.uid()) OR is_community_mod_or_admin(community_id, auth.uid()))) WITH CHECK (((invited_user_id = auth.uid()) OR is_community_mod_or_admin(community_id, auth.uid())));

CREATE POLICY join_requests_insert ON public.community_join_requests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

CREATE POLICY join_requests_select_own ON public.community_join_requests AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = community_join_requests.community_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['moderator'::text, 'admin'::text])) AND (m.status = 'active'::text))))));

CREATE POLICY join_requests_update_mod ON public.community_join_requests AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = community_join_requests.community_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['moderator'::text, 'admin'::text])) AND (m.status = 'active'::text)))));

CREATE POLICY memberships_delete_own ON public.community_memberships AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY memberships_insert_invite ON public.community_memberships AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((user_id = auth.uid()) AND (status = 'active'::text) AND (role = 'member'::text) AND (EXISTS ( SELECT 1
   FROM community_invites ci
  WHERE ((ci.community_id = community_memberships.community_id) AND (ci.invited_user_id = auth.uid()) AND (ci.status = ANY (ARRAY['pending'::text, 'accepted'::text]))))) AND (EXISTS ( SELECT 1
   FROM communities c
  WHERE ((c.id = community_memberships.community_id) AND (c.privacy = 'invite'::text) AND (c.approval_status = 'approved'::text))))));

CREATE POLICY memberships_insert_mod ON public.community_memberships AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((is_community_mod_or_admin(community_id, auth.uid()) AND (status = 'active'::text)));

CREATE POLICY memberships_insert_open ON public.community_memberships AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (status = 'active'::text) AND (role = 'member'::text) AND (EXISTS ( SELECT 1
   FROM communities c
  WHERE ((c.id = community_memberships.community_id) AND (c.privacy = 'open'::text) AND (c.approval_status = 'approved'::text))))));

CREATE POLICY memberships_mod_update ON public.community_memberships AS PERMISSIVE FOR UPDATE TO authenticated USING (is_community_mod_or_admin(community_id, auth.uid()));

CREATE POLICY memberships_select_own ON public.community_memberships AS PERMISSIVE FOR SELECT TO anon, authenticated USING (((user_id = auth.uid()) OR is_community_mod_or_admin(community_id, auth.uid())));

CREATE POLICY memberships_update_own_mute ON public.community_memberships AS PERMISSIVE FOR UPDATE TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY comm_post_likes_delete ON public.community_post_likes AS PERMISSIVE FOR DELETE TO authenticated USING ((user_id = auth.uid()));

CREATE POLICY comm_post_likes_insert ON public.community_post_likes AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (community_posts p
     JOIN community_memberships m ON ((m.community_id = p.community_id)))
  WHERE ((p.id = community_post_likes.post_id) AND (p.moderation_status = 'approved'::text) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));

CREATE POLICY comm_post_likes_select ON public.community_post_likes AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (community_memberships m
     JOIN community_posts p ON ((p.id = community_post_likes.post_id)))
  WHERE ((m.community_id = p.community_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text)))));

CREATE POLICY comm_posts_delete_author ON public.community_posts AS PERMISSIVE FOR DELETE TO authenticated USING ((author_id = auth.uid()));

CREATE POLICY comm_posts_delete_mod ON public.community_posts AS PERMISSIVE FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = community_posts.community_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['moderator'::text, 'admin'::text])) AND (m.status = 'active'::text)))));

CREATE POLICY comm_posts_insert ON public.community_posts AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = community_posts.community_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));

CREATE POLICY comm_posts_select ON public.community_posts AS PERMISSIVE FOR SELECT TO authenticated USING ((((moderation_status = 'approved'::text) OR (author_id = auth.uid()) OR is_community_mod_or_admin(community_id, auth.uid())) AND (EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = community_posts.community_id) AND (m.user_id = auth.uid()) AND (m.status = 'active'::text))))));

CREATE POLICY comm_posts_update_author ON public.community_posts AS PERMISSIVE FOR UPDATE TO authenticated USING ((author_id = auth.uid()));

CREATE POLICY comm_posts_update_mod ON public.community_posts AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM community_memberships m
  WHERE ((m.community_id = community_posts.community_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['moderator'::text, 'admin'::text])) AND (m.status = 'active'::text)))));

CREATE POLICY "Participants can delete non-group conversations" ON public.conversations AS PERMISSIVE FOR DELETE TO authenticated USING (((auth.uid() = ANY (participant_ids)) AND (type IS DISTINCT FROM 'group'::text)));

CREATE POLICY "Participants can read conversations" ON public.conversations AS PERMISSIVE FOR SELECT TO authenticated USING ((auth.uid() = ANY (participant_ids)));

CREATE POLICY "Participants can update non-group conversations" ON public.conversations AS PERMISSIVE FOR UPDATE TO authenticated USING (((auth.uid() = ANY (participant_ids)) AND (type IS DISTINCT FROM 'group'::text))) WITH CHECK (((auth.uid() = ANY (participant_ids)) AND (type IS DISTINCT FROM 'group'::text)));

CREATE POLICY "Users can create non-group conversations" ON public.conversations AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((auth.uid() = ANY (participant_ids)) AND (type IS DISTINCT FROM 'group'::text)));

CREATE POLICY "Users can view conversations they participate in" ON public.conversations AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = ANY (participant_ids)));

CREATE POLICY "Admin only: read all disputes" ON public.disputes AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.is_admin = true)))));

CREATE POLICY "Users can read own disputes" ON public.disputes AS PERMISSIVE FOR SELECT TO PUBLIC USING (((opened_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM escrow_transactions
  WHERE ((escrow_transactions.id = disputes.transaction_id) AND ((escrow_transactions.buyer_id = ( SELECT auth.uid() AS uid)) OR (escrow_transactions.seller_id = ( SELECT auth.uid() AS uid))))))));

CREATE POLICY "Users can create escrow transactions" ON public.escrow_transactions AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((( SELECT auth.uid() AS uid) = buyer_id) OR (( SELECT auth.uid() AS uid) = seller_id)));

CREATE POLICY "Users can read own escrow transactions" ON public.escrow_transactions AS PERMISSIVE FOR SELECT TO PUBLIC USING (((( SELECT auth.uid() AS uid) = buyer_id) OR (( SELECT auth.uid() AS uid) = seller_id)));

CREATE POLICY "Users can update own escrow transactions" ON public.escrow_transactions AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((( SELECT auth.uid() AS uid) = buyer_id) OR (( SELECT auth.uid() AS uid) = seller_id))) WITH CHECK (((( SELECT auth.uid() AS uid) = buyer_id) OR (( SELECT auth.uid() AS uid) = seller_id)));

CREATE POLICY "Users can delete their own bookmarks" ON public.event_bookmarks AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert their own bookmarks" ON public.event_bookmarks AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view their own bookmarks" ON public.event_bookmarks AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Organizers can view their own payouts" ON public.event_payouts AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = organizer_id));

CREATE POLICY "Organizers can archive their own events" ON public.events AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((organizer_id = auth.uid())) WITH CHECK ((organizer_id = auth.uid()));

CREATE POLICY "Public can view published events" ON public.events AS PERMISSIVE FOR SELECT TO PUBLIC USING ((status = 'PUBLISHED'::text));

CREATE POLICY events_all_own ON public.events AS PERMISSIVE FOR ALL TO PUBLIC USING ((organizer_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((organizer_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY events_insert_own ON public.events AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((organizer_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY events_update_own ON public.events AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((organizer_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Followers are viewable by everyone" ON public.followers AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can delete their own follows" ON public.followers AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = follower_id));

CREATE POLICY "Users can insert their own follows" ON public.followers AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = follower_id));

CREATE POLICY "Users can remove their followers" ON public.followers AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = following_id));

CREATE POLICY "Users can delete friend requests" ON public.friend_requests AS PERMISSIVE FOR DELETE TO PUBLIC USING (((( SELECT auth.uid() AS uid) = from_user_id) OR (( SELECT auth.uid() AS uid) = to_user_id)));

CREATE POLICY "Users can insert friend requests" ON public.friend_requests AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = from_user_id));

CREATE POLICY "Users can update friend requests" ON public.friend_requests AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((( SELECT auth.uid() AS uid) = from_user_id) OR (( SELECT auth.uid() AS uid) = to_user_id)));

CREATE POLICY "Users can view friend requests" ON public.friend_requests AS PERMISSIVE FOR SELECT TO PUBLIC USING (((( SELECT auth.uid() AS uid) = from_user_id) OR (( SELECT auth.uid() AS uid) = to_user_id)));

CREATE POLICY "Users can create item chats" ON public.item_chats AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((( SELECT auth.uid() AS uid) = buyer_id) OR (( SELECT auth.uid() AS uid) = seller_id)));

CREATE POLICY "Users can read own item chats" ON public.item_chats AS PERMISSIVE FOR SELECT TO PUBLIC USING (((( SELECT auth.uid() AS uid) = buyer_id) OR (( SELECT auth.uid() AS uid) = seller_id)));

CREATE POLICY "Enable read access for all users" ON public.lga_wards AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Enable insert for rate limits" ON public.marketing_rate_limits AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((id IS NOT NULL));

CREATE POLICY "Enable select for rate limits" ON public.marketing_rate_limits AS PERMISSIVE FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Participants can read messages" ON public.messages AS PERMISSIVE FOR SELECT TO authenticated USING (is_messages_participant(conversation_id));

CREATE POLICY "Participants can send direct messages" ON public.messages AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((sender_id = auth.uid()) AND is_messages_participant(conversation_id) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.type IS DISTINCT FROM 'group'::text))))));

CREATE POLICY "Participants can update direct messages" ON public.messages AS PERMISSIVE FOR UPDATE TO authenticated USING ((is_messages_participant(conversation_id) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.type IS DISTINCT FROM 'group'::text)))))) WITH CHECK ((is_messages_participant(conversation_id) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.type IS DISTINCT FROM 'group'::text))))));

CREATE POLICY "Users can delete their own direct messages" ON public.messages AS PERMISSIVE FOR DELETE TO authenticated USING (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.type IS DISTINCT FROM 'group'::text))))));

CREATE POLICY "Users can view messages in their conversations" ON public.messages AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM conversations
  WHERE ((conversations.id = messages.conversation_id) AND (( SELECT auth.uid() AS uid) = ANY (conversations.participant_ids))))));

CREATE POLICY "Admins can update moderation queue" ON public.moderation_queue AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.is_admin = true)))));

CREATE POLICY "Admins can view moderation queue" ON public.moderation_queue AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND (users.is_admin = true)))));

CREATE POLICY "Users can insert moderation queue items" ON public.moderation_queue AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert their own tickets" ON public.my_tickets AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can update their own tickets" ON public.my_tickets AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view their own tickets" ON public.my_tickets AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can delete their own notifications" ON public.notifications AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert notifications" ON public.notifications AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Users can update their own notifications" ON public.notifications AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view their own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can manage own payout requests" ON public.payout_requests AS PERMISSIVE FOR ALL TO PUBLIC USING ((( SELECT auth.uid() AS uid) = seller_id));

CREATE POLICY "Users can delete their own post bookmarks" ON public.post_bookmarks AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can insert their own post bookmarks" ON public.post_bookmarks AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view their own post bookmarks" ON public.post_bookmarks AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Admins can delete post reports" ON public.post_reports AS PERMISSIVE FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text))))));

CREATE POLICY "Admins can update post reports" ON public.post_reports AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text))))));

CREATE POLICY "Reporters and admins can view post reports" ON public.post_reports AS PERMISSIVE FOR SELECT TO authenticated USING (((reporter_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text)))))));

CREATE POLICY "Users can insert own post reports" ON public.post_reports AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((reporter_id = auth.uid()));

CREATE POLICY "Allow select on posts" ON public.posts AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can create posts" ON public.posts AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can delete own posts" ON public.posts AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can update own posts" ON public.posts AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Owners manage provider availability" ON public.provider_availability AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.uid() IN ( SELECT businesses.owner_id
   FROM businesses
  WHERE (businesses.id = provider_availability.business_id))));

CREATE POLICY "Public read provider availability" ON public.provider_availability AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can manage own push subscriptions" ON public.push_subscriptions AS PERMISSIVE FOR ALL TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "participants insert messages" ON public.quote_messages AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((sender_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM quote_requests qr
  WHERE ((qr.id = quote_messages.quote_id) AND ((qr.customer_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM businesses b
          WHERE ((b.id = qr.business_id) AND (b.owner_id = auth.uid()))))))))));

CREATE POLICY "participants read messages" ON public.quote_messages AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM quote_requests qr
  WHERE ((qr.id = quote_messages.quote_id) AND ((qr.customer_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM businesses b
          WHERE ((b.id = qr.business_id) AND (b.owner_id = auth.uid())))))))));

CREATE POLICY "business read own quotes" ON public.quote_requests AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = quote_requests.business_id) AND (b.owner_id = auth.uid())))));

CREATE POLICY "business update own quotes" ON public.quote_requests AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = quote_requests.business_id) AND (b.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM businesses b
  WHERE ((b.id = quote_requests.business_id) AND (b.owner_id = auth.uid())))));

CREATE POLICY "customer create own quotes" ON public.quote_requests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((customer_id = auth.uid()));

CREATE POLICY "customer crud own quotes" ON public.quote_requests AS PERMISSIVE FOR ALL TO PUBLIC USING ((customer_id = auth.uid())) WITH CHECK ((customer_id = auth.uid()));

CREATE POLICY "customer delete draft quotes" ON public.quote_requests AS PERMISSIVE FOR DELETE TO authenticated USING (((customer_id = auth.uid()) AND (status = ANY (ARRAY['pending'::quote_status, 'rejected'::quote_status, 'expired'::quote_status, 'cancelled'::quote_status]))));

CREATE POLICY "customer read own quotes" ON public.quote_requests AS PERMISSIVE FOR SELECT TO authenticated USING ((customer_id = auth.uid()));

CREATE POLICY "customer update own quotes" ON public.quote_requests AS PERMISSIVE FOR UPDATE TO authenticated USING ((customer_id = auth.uid())) WITH CHECK ((customer_id = auth.uid()));

CREATE POLICY "Deny public access to rate_limits" ON public.rate_limits AS PERMISSIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "Admins can update reports" ON public.reports AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text))))));

CREATE POLICY "Users can insert own reports" ON public.reports AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((((user_id IS NULL) OR (user_id = auth.uid())) AND ((reporter_id IS NULL) OR (reporter_id = auth.uid())) AND ((user_id IS NOT NULL) OR (reporter_id IS NOT NULL))));

CREATE POLICY "Users can view own reports or admins all" ON public.reports AS PERMISSIVE FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (reporter_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin OR (u.role = 'admin'::text)))))));

CREATE POLICY "Anyone can insert safety alerts" ON public.safety_alerts AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Anyone can update safety alerts" ON public.safety_alerts AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) IS NOT NULL)) WITH CHECK ((( SELECT auth.uid() AS uid) IS NOT NULL));

CREATE POLICY "Anyone can view all safety alerts" ON public.safety_alerts AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can manage own seller accounts" ON public.seller_accounts AS PERMISSIVE FOR ALL TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Owners manage service offerings" ON public.service_offerings AS PERMISSIVE FOR ALL TO PUBLIC USING ((auth.uid() IN ( SELECT businesses.owner_id
   FROM businesses
  WHERE (businesses.id = service_offerings.business_id))));

CREATE POLICY "Public read service offerings" ON public.service_offerings AS PERMISSIVE FOR SELECT TO PUBLIC USING (((is_active = true) OR (auth.uid() IN ( SELECT businesses.owner_id
   FROM businesses
  WHERE (businesses.id = service_offerings.business_id)))));

CREATE POLICY "owner manage assignments" ON public.service_staff_assignments AS PERMISSIVE FOR ALL TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM (service_offerings so
     JOIN businesses b ON ((b.id = so.business_id)))
  WHERE ((so.id = service_staff_assignments.service_id) AND (b.owner_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (service_offerings so
     JOIN businesses b ON ((b.id = so.business_id)))
  WHERE ((so.id = service_staff_assignments.service_id) AND (b.owner_id = auth.uid())))));

CREATE POLICY "public read assignments" ON public.service_staff_assignments AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Deny public access to sms_delivery_logs" ON public.sms_delivery_logs AS PERMISSIVE FOR ALL TO PUBLIC USING (false);

CREATE POLICY "admin read all appeals" ON public.strike_appeals AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin = true)))));

CREATE POLICY "admin update appeals" ON public.strike_appeals AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin = true)))));

CREATE POLICY "appellant insert own appeal" ON public.strike_appeals AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((appellant_id = auth.uid()));

CREATE POLICY "appellant read own appeals" ON public.strike_appeals AS PERMISSIVE FOR SELECT TO PUBLIC USING ((appellant_id = auth.uid()));

CREATE POLICY "Public can view ticket tiers" ON public.ticket_tiers AS PERMISSIVE FOR SELECT TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM events
  WHERE ((events.id = ticket_tiers.event_id) AND (events.status = 'PUBLISHED'::text)))));

CREATE POLICY ticket_tiers_all_own ON public.ticket_tiers AS PERMISSIVE FOR ALL TO PUBLIC USING ((event_id IN ( SELECT events.id
   FROM events
  WHERE (events.organizer_id = ( SELECT auth.uid() AS uid))))) WITH CHECK ((event_id IN ( SELECT events.id
   FROM events
  WHERE (events.organizer_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY ticket_tiers_insert_own ON public.ticket_tiers AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((event_id IN ( SELECT events.id
   FROM events
  WHERE (events.organizer_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY ticket_tiers_update_own ON public.ticket_tiers AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((event_id IN ( SELECT events.id
   FROM events
  WHERE (events.organizer_id = ( SELECT auth.uid() AS uid)))));

CREATE POLICY "Buyers can view their own tickets" ON public.tickets AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = buyer_id));

CREATE POLICY "Organizers can view and update tickets for their events" ON public.tickets AS PERMISSIVE FOR ALL TO PUBLIC USING ((EXISTS ( SELECT 1
   FROM events
  WHERE ((events.id = tickets.event_id) AND (events.organizer_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "Users can archive their own tickets" ON public.tickets AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((buyer_id = auth.uid())) WITH CHECK ((buyer_id = auth.uid()));

CREATE POLICY tickets_insert_own ON public.tickets AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((buyer_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY tickets_update_own ON public.tickets AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((buyer_id = ( SELECT auth.uid() AS uid)) OR (event_id IN ( SELECT events.id
   FROM events
  WHERE (events.organizer_id = ( SELECT auth.uid() AS uid))))));

CREATE POLICY "Users can insert their own transactions" ON public.transactions AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can view their own transactions" ON public.transactions AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Users can update their own typing status" ON public.typing_status AS PERMISSIVE FOR ALL TO PUBLIC USING ((user_id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "Users can view typing status in their conversations" ON public.typing_status AS PERMISSIVE FOR SELECT TO PUBLIC USING ((conversation_id IN ( SELECT conversations.id
   FROM conversations
  WHERE (conversations.participant_ids @> ARRAY[( SELECT auth.uid() AS uid)]))));

CREATE POLICY "Users can create blocks" ON public.user_blocks AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = blocker_id));

CREATE POLICY "Users can delete their blocks" ON public.user_blocks AS PERMISSIVE FOR DELETE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = blocker_id));

CREATE POLICY "Users can view their own blocks" ON public.user_blocks AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.uid() AS uid) = blocker_id));

CREATE POLICY "Users can delete their own push tokens" ON public.user_push_tokens AS PERMISSIVE FOR DELETE TO PUBLIC USING ((user_id = auth.uid()));

CREATE POLICY "Users can insert their own push tokens" ON public.user_push_tokens AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Users can update their own push tokens" ON public.user_push_tokens AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

CREATE POLICY "Users can view their own push tokens" ON public.user_push_tokens AS PERMISSIVE FOR SELECT TO PUBLIC USING ((user_id = auth.uid()));

CREATE POLICY "Buyers can insert reviews" ON public.user_reviews AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = buyer_id));

CREATE POLICY "Users can view all reviews" ON public.user_reviews AS PERMISSIVE FOR SELECT TO PUBLIC USING (true);

CREATE POLICY "Users can insert own data" ON public.users AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "Users can read all users" ON public.users AS PERMISSIVE FOR SELECT TO PUBLIC USING ((( SELECT auth.role() AS role) = 'authenticated'::text));

CREATE POLICY "Users can update own data" ON public.users AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((( SELECT auth.uid() AS uid) = id)) WITH CHECK ((( SELECT auth.uid() AS uid) = id));

CREATE POLICY "Users can manage own verification documents" ON public.verification_documents AS PERMISSIVE FOR ALL TO PUBLIC USING ((( SELECT auth.uid() AS uid) = user_id));

CREATE POLICY "Allow authenticated users to insert to pending" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'pending-moderation'::text));

CREATE POLICY "Allow authenticated users to select own pending" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'pending-moderation'::text) AND (auth.uid() = owner)));

CREATE POLICY "Allow authenticated users to upload chat images" ON storage.objects AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((bucket_id = 'chat-images'::text) AND (auth.role() = 'authenticated'::text)));

CREATE POLICY "Allow authenticated users to view chat images" ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING (((bucket_id = 'chat-images'::text) AND (auth.role() = 'authenticated'::text)));

CREATE POLICY "Allow users to delete their own chat images" ON storage.objects AS PERMISSIVE FOR DELETE TO PUBLIC USING (((bucket_id = 'chat-images'::text) AND (auth.role() = 'authenticated'::text)));

CREATE POLICY "Allow users to update their own chat images" ON storage.objects AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((bucket_id = 'chat-images'::text) AND (auth.role() = 'authenticated'::text)));

CREATE POLICY "Authenticated users can delete post images" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING ((bucket_id = 'post-images'::text));

CREATE POLICY "Authenticated users can update post images" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING ((bucket_id = 'post-images'::text));

CREATE POLICY "Authenticated users can upload catalog item images" ON storage.objects AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((bucket_id = 'catalog-items'::text) AND (auth.role() = 'authenticated'::text)));

CREATE POLICY "Authenticated users can upload post images" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'post-images'::text));

CREATE POLICY "Authenticated users upload chat videos" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'chat-videos'::text));

CREATE POLICY "Authenticated users upload post videos" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'post-videos'::text));

CREATE POLICY "Dispute parties and admins read evidence" ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING (((bucket_id = 'dispute-evidence'::text) AND ((EXISTS ( SELECT 1
   FROM escrow_transactions tx
  WHERE (((tx.id)::text = (storage.foldername(objects.name))[1]) AND ((tx.buyer_id = auth.uid()) OR (tx.seller_id = auth.uid()))))) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = auth.uid()) AND (u.is_admin = true)))))));

CREATE POLICY "Dispute parties upload evidence" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'dispute-evidence'::text) AND ((storage.foldername(name))[2] = (auth.uid())::text) AND (EXISTS ( SELECT 1
   FROM escrow_transactions tx
  WHERE (((tx.id)::text = (storage.foldername(objects.name))[1]) AND ((tx.buyer_id = auth.uid()) OR (tx.seller_id = auth.uid())))))));

CREATE POLICY "Public read report images" ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING ((bucket_id = 'reports'::text));

CREATE POLICY "Service upload brand-assets" ON storage.objects AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((bucket_id = 'brand-assets'::text));

CREATE POLICY "Users can delete their own avatars" ON storage.objects AS PERMISSIVE FOR DELETE TO PUBLIC USING (((bucket_id = 'user-avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[2])));

CREATE POLICY "Users can delete their own catalog item images" ON storage.objects AS PERMISSIVE FOR DELETE TO PUBLIC USING (((bucket_id = 'catalog-items'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));

CREATE POLICY "Users can delete their own chat images" ON storage.objects AS PERMISSIVE FOR DELETE TO PUBLIC USING (((bucket_id = 'chat-images'::text) AND ((auth.uid())::text = (storage.foldername(name))[2])));

CREATE POLICY "Users can update their own avatars" ON storage.objects AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((bucket_id = 'user-avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[2])));

CREATE POLICY "Users can update their own catalog item images" ON storage.objects AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((bucket_id = 'catalog-items'::text) AND ((auth.uid())::text = (storage.foldername(name))[1])));

CREATE POLICY "Users can update their own chat images" ON storage.objects AS PERMISSIVE FOR UPDATE TO PUBLIC USING (((bucket_id = 'chat-images'::text) AND ((auth.uid())::text = (storage.foldername(name))[2])));

CREATE POLICY "Users can upload report images to their folder" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'reports'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "Users can upload their own avatars" ON storage.objects AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((bucket_id = 'user-avatars'::text) AND ((auth.uid())::text = (storage.foldername(name))[2])));

CREATE POLICY "Users can upload their own chat images" ON storage.objects AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK (((bucket_id = 'chat-images'::text) AND ((auth.uid())::text = (storage.foldername(name))[2])));

CREATE POLICY "Users delete own post videos" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'post-videos'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "Users upload their own community images" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'community-images'::text) AND ((storage.foldername(name))[1] = (( SELECT auth.uid() AS uid))::text)));

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,anon,authenticated,service_role;

GRANT DELETE ON TABLE public.admin_sessions TO postgres;

GRANT INSERT ON TABLE public.admin_sessions TO postgres;

GRANT MAINTAIN ON TABLE public.admin_sessions TO postgres;

GRANT REFERENCES ON TABLE public.admin_sessions TO postgres;

GRANT SELECT ON TABLE public.admin_sessions TO postgres;

GRANT TRIGGER ON TABLE public.admin_sessions TO postgres;

GRANT TRUNCATE ON TABLE public.admin_sessions TO postgres;

GRANT UPDATE ON TABLE public.admin_sessions TO postgres;

GRANT DELETE ON TABLE public.admin_sessions TO anon;

GRANT INSERT ON TABLE public.admin_sessions TO anon;

GRANT MAINTAIN ON TABLE public.admin_sessions TO anon;

GRANT REFERENCES ON TABLE public.admin_sessions TO anon;

GRANT SELECT ON TABLE public.admin_sessions TO anon;

GRANT TRIGGER ON TABLE public.admin_sessions TO anon;

GRANT TRUNCATE ON TABLE public.admin_sessions TO anon;

GRANT UPDATE ON TABLE public.admin_sessions TO anon;

GRANT DELETE ON TABLE public.admin_sessions TO authenticated;

GRANT INSERT ON TABLE public.admin_sessions TO authenticated;

GRANT MAINTAIN ON TABLE public.admin_sessions TO authenticated;

GRANT REFERENCES ON TABLE public.admin_sessions TO authenticated;

GRANT SELECT ON TABLE public.admin_sessions TO authenticated;

GRANT TRIGGER ON TABLE public.admin_sessions TO authenticated;

GRANT TRUNCATE ON TABLE public.admin_sessions TO authenticated;

GRANT UPDATE ON TABLE public.admin_sessions TO authenticated;

GRANT DELETE ON TABLE public.admin_sessions TO service_role;

GRANT INSERT ON TABLE public.admin_sessions TO service_role;

GRANT MAINTAIN ON TABLE public.admin_sessions TO service_role;

GRANT REFERENCES ON TABLE public.admin_sessions TO service_role;

GRANT SELECT ON TABLE public.admin_sessions TO service_role;

GRANT TRIGGER ON TABLE public.admin_sessions TO service_role;

GRANT TRUNCATE ON TABLE public.admin_sessions TO service_role;

GRANT UPDATE ON TABLE public.admin_sessions TO service_role;

GRANT DELETE ON TABLE public.alerts TO postgres;

GRANT INSERT ON TABLE public.alerts TO postgres;

GRANT MAINTAIN ON TABLE public.alerts TO postgres;

GRANT REFERENCES ON TABLE public.alerts TO postgres;

GRANT SELECT ON TABLE public.alerts TO postgres;

GRANT TRIGGER ON TABLE public.alerts TO postgres;

GRANT TRUNCATE ON TABLE public.alerts TO postgres;

GRANT UPDATE ON TABLE public.alerts TO postgres;

GRANT DELETE ON TABLE public.alerts TO anon;

GRANT INSERT ON TABLE public.alerts TO anon;

GRANT MAINTAIN ON TABLE public.alerts TO anon;

GRANT REFERENCES ON TABLE public.alerts TO anon;

GRANT SELECT ON TABLE public.alerts TO anon;

GRANT TRIGGER ON TABLE public.alerts TO anon;

GRANT TRUNCATE ON TABLE public.alerts TO anon;

GRANT UPDATE ON TABLE public.alerts TO anon;

GRANT DELETE ON TABLE public.alerts TO authenticated;

GRANT INSERT ON TABLE public.alerts TO authenticated;

GRANT MAINTAIN ON TABLE public.alerts TO authenticated;

GRANT REFERENCES ON TABLE public.alerts TO authenticated;

GRANT SELECT ON TABLE public.alerts TO authenticated;

GRANT TRIGGER ON TABLE public.alerts TO authenticated;

GRANT TRUNCATE ON TABLE public.alerts TO authenticated;

GRANT UPDATE ON TABLE public.alerts TO authenticated;

GRANT DELETE ON TABLE public.alerts TO service_role;

GRANT INSERT ON TABLE public.alerts TO service_role;

GRANT MAINTAIN ON TABLE public.alerts TO service_role;

GRANT REFERENCES ON TABLE public.alerts TO service_role;

GRANT SELECT ON TABLE public.alerts TO service_role;

GRANT TRIGGER ON TABLE public.alerts TO service_role;

GRANT TRUNCATE ON TABLE public.alerts TO service_role;

GRANT UPDATE ON TABLE public.alerts TO service_role;

GRANT DELETE ON TABLE public.availability_exceptions TO postgres;

GRANT INSERT ON TABLE public.availability_exceptions TO postgres;

GRANT MAINTAIN ON TABLE public.availability_exceptions TO postgres;

GRANT REFERENCES ON TABLE public.availability_exceptions TO postgres;

GRANT SELECT ON TABLE public.availability_exceptions TO postgres;

GRANT TRIGGER ON TABLE public.availability_exceptions TO postgres;

GRANT TRUNCATE ON TABLE public.availability_exceptions TO postgres;

GRANT UPDATE ON TABLE public.availability_exceptions TO postgres;

GRANT DELETE ON TABLE public.availability_exceptions TO anon;

GRANT INSERT ON TABLE public.availability_exceptions TO anon;

GRANT MAINTAIN ON TABLE public.availability_exceptions TO anon;

GRANT REFERENCES ON TABLE public.availability_exceptions TO anon;

GRANT SELECT ON TABLE public.availability_exceptions TO anon;

GRANT TRIGGER ON TABLE public.availability_exceptions TO anon;

GRANT TRUNCATE ON TABLE public.availability_exceptions TO anon;

GRANT UPDATE ON TABLE public.availability_exceptions TO anon;

GRANT DELETE ON TABLE public.availability_exceptions TO authenticated;

GRANT INSERT ON TABLE public.availability_exceptions TO authenticated;

GRANT MAINTAIN ON TABLE public.availability_exceptions TO authenticated;

GRANT REFERENCES ON TABLE public.availability_exceptions TO authenticated;

GRANT SELECT ON TABLE public.availability_exceptions TO authenticated;

GRANT TRIGGER ON TABLE public.availability_exceptions TO authenticated;

GRANT TRUNCATE ON TABLE public.availability_exceptions TO authenticated;

GRANT UPDATE ON TABLE public.availability_exceptions TO authenticated;

GRANT DELETE ON TABLE public.availability_exceptions TO service_role;

GRANT INSERT ON TABLE public.availability_exceptions TO service_role;

GRANT MAINTAIN ON TABLE public.availability_exceptions TO service_role;

GRANT REFERENCES ON TABLE public.availability_exceptions TO service_role;

GRANT SELECT ON TABLE public.availability_exceptions TO service_role;

GRANT TRIGGER ON TABLE public.availability_exceptions TO service_role;

GRANT TRUNCATE ON TABLE public.availability_exceptions TO service_role;

GRANT UPDATE ON TABLE public.availability_exceptions TO service_role;

GRANT DELETE ON TABLE public.booking_payments TO postgres;

GRANT INSERT ON TABLE public.booking_payments TO postgres;

GRANT MAINTAIN ON TABLE public.booking_payments TO postgres;

GRANT REFERENCES ON TABLE public.booking_payments TO postgres;

GRANT SELECT ON TABLE public.booking_payments TO postgres;

GRANT TRIGGER ON TABLE public.booking_payments TO postgres;

GRANT TRUNCATE ON TABLE public.booking_payments TO postgres;

GRANT UPDATE ON TABLE public.booking_payments TO postgres;

GRANT DELETE ON TABLE public.booking_payments TO anon;

GRANT INSERT ON TABLE public.booking_payments TO anon;

GRANT MAINTAIN ON TABLE public.booking_payments TO anon;

GRANT REFERENCES ON TABLE public.booking_payments TO anon;

GRANT SELECT ON TABLE public.booking_payments TO anon;

GRANT TRIGGER ON TABLE public.booking_payments TO anon;

GRANT TRUNCATE ON TABLE public.booking_payments TO anon;

GRANT UPDATE ON TABLE public.booking_payments TO anon;

GRANT DELETE ON TABLE public.booking_payments TO authenticated;

GRANT INSERT ON TABLE public.booking_payments TO authenticated;

GRANT MAINTAIN ON TABLE public.booking_payments TO authenticated;

GRANT REFERENCES ON TABLE public.booking_payments TO authenticated;

GRANT SELECT ON TABLE public.booking_payments TO authenticated;

GRANT TRIGGER ON TABLE public.booking_payments TO authenticated;

GRANT TRUNCATE ON TABLE public.booking_payments TO authenticated;

GRANT UPDATE ON TABLE public.booking_payments TO authenticated;

GRANT DELETE ON TABLE public.booking_payments TO service_role;

GRANT INSERT ON TABLE public.booking_payments TO service_role;

GRANT MAINTAIN ON TABLE public.booking_payments TO service_role;

GRANT REFERENCES ON TABLE public.booking_payments TO service_role;

GRANT SELECT ON TABLE public.booking_payments TO service_role;

GRANT TRIGGER ON TABLE public.booking_payments TO service_role;

GRANT TRUNCATE ON TABLE public.booking_payments TO service_role;

GRANT UPDATE ON TABLE public.booking_payments TO service_role;

GRANT DELETE ON TABLE public.bookings TO postgres;

GRANT INSERT ON TABLE public.bookings TO postgres;

GRANT MAINTAIN ON TABLE public.bookings TO postgres;

GRANT REFERENCES ON TABLE public.bookings TO postgres;

GRANT SELECT ON TABLE public.bookings TO postgres;

GRANT TRIGGER ON TABLE public.bookings TO postgres;

GRANT TRUNCATE ON TABLE public.bookings TO postgres;

GRANT UPDATE ON TABLE public.bookings TO postgres;

GRANT DELETE ON TABLE public.bookings TO anon;

GRANT INSERT ON TABLE public.bookings TO anon;

GRANT MAINTAIN ON TABLE public.bookings TO anon;

GRANT REFERENCES ON TABLE public.bookings TO anon;

GRANT SELECT ON TABLE public.bookings TO anon;

GRANT TRIGGER ON TABLE public.bookings TO anon;

GRANT TRUNCATE ON TABLE public.bookings TO anon;

GRANT UPDATE ON TABLE public.bookings TO anon;

GRANT DELETE ON TABLE public.bookings TO authenticated;

GRANT INSERT ON TABLE public.bookings TO authenticated;

GRANT MAINTAIN ON TABLE public.bookings TO authenticated;

GRANT REFERENCES ON TABLE public.bookings TO authenticated;

GRANT SELECT ON TABLE public.bookings TO authenticated;

GRANT TRIGGER ON TABLE public.bookings TO authenticated;

GRANT TRUNCATE ON TABLE public.bookings TO authenticated;

GRANT UPDATE ON TABLE public.bookings TO authenticated;

GRANT DELETE ON TABLE public.bookings TO service_role;

GRANT INSERT ON TABLE public.bookings TO service_role;

GRANT MAINTAIN ON TABLE public.bookings TO service_role;

GRANT REFERENCES ON TABLE public.bookings TO service_role;

GRANT SELECT ON TABLE public.bookings TO service_role;

GRANT TRIGGER ON TABLE public.bookings TO service_role;

GRANT TRUNCATE ON TABLE public.bookings TO service_role;

GRANT UPDATE ON TABLE public.bookings TO service_role;

GRANT DELETE ON TABLE public.business_favorites TO postgres;

GRANT INSERT ON TABLE public.business_favorites TO postgres;

GRANT MAINTAIN ON TABLE public.business_favorites TO postgres;

GRANT REFERENCES ON TABLE public.business_favorites TO postgres;

GRANT SELECT ON TABLE public.business_favorites TO postgres;

GRANT TRIGGER ON TABLE public.business_favorites TO postgres;

GRANT TRUNCATE ON TABLE public.business_favorites TO postgres;

GRANT UPDATE ON TABLE public.business_favorites TO postgres;

GRANT DELETE ON TABLE public.business_favorites TO anon;

GRANT INSERT ON TABLE public.business_favorites TO anon;

GRANT MAINTAIN ON TABLE public.business_favorites TO anon;

GRANT REFERENCES ON TABLE public.business_favorites TO anon;

GRANT SELECT ON TABLE public.business_favorites TO anon;

GRANT TRIGGER ON TABLE public.business_favorites TO anon;

GRANT TRUNCATE ON TABLE public.business_favorites TO anon;

GRANT UPDATE ON TABLE public.business_favorites TO anon;

GRANT DELETE ON TABLE public.business_favorites TO authenticated;

GRANT INSERT ON TABLE public.business_favorites TO authenticated;

GRANT MAINTAIN ON TABLE public.business_favorites TO authenticated;

GRANT REFERENCES ON TABLE public.business_favorites TO authenticated;

GRANT SELECT ON TABLE public.business_favorites TO authenticated;

GRANT TRIGGER ON TABLE public.business_favorites TO authenticated;

GRANT TRUNCATE ON TABLE public.business_favorites TO authenticated;

GRANT UPDATE ON TABLE public.business_favorites TO authenticated;

GRANT DELETE ON TABLE public.business_favorites TO service_role;

GRANT INSERT ON TABLE public.business_favorites TO service_role;

GRANT MAINTAIN ON TABLE public.business_favorites TO service_role;

GRANT REFERENCES ON TABLE public.business_favorites TO service_role;

GRANT SELECT ON TABLE public.business_favorites TO service_role;

GRANT TRIGGER ON TABLE public.business_favorites TO service_role;

GRANT TRUNCATE ON TABLE public.business_favorites TO service_role;

GRANT UPDATE ON TABLE public.business_favorites TO service_role;

GRANT DELETE ON TABLE public.business_messages TO postgres;

GRANT INSERT ON TABLE public.business_messages TO postgres;

GRANT MAINTAIN ON TABLE public.business_messages TO postgres;

GRANT REFERENCES ON TABLE public.business_messages TO postgres;

GRANT SELECT ON TABLE public.business_messages TO postgres;

GRANT TRIGGER ON TABLE public.business_messages TO postgres;

GRANT TRUNCATE ON TABLE public.business_messages TO postgres;

GRANT UPDATE ON TABLE public.business_messages TO postgres;

GRANT DELETE ON TABLE public.business_messages TO anon;

GRANT INSERT ON TABLE public.business_messages TO anon;

GRANT MAINTAIN ON TABLE public.business_messages TO anon;

GRANT REFERENCES ON TABLE public.business_messages TO anon;

GRANT SELECT ON TABLE public.business_messages TO anon;

GRANT TRIGGER ON TABLE public.business_messages TO anon;

GRANT TRUNCATE ON TABLE public.business_messages TO anon;

GRANT UPDATE ON TABLE public.business_messages TO anon;

GRANT DELETE ON TABLE public.business_messages TO authenticated;

GRANT INSERT ON TABLE public.business_messages TO authenticated;

GRANT MAINTAIN ON TABLE public.business_messages TO authenticated;

GRANT REFERENCES ON TABLE public.business_messages TO authenticated;

GRANT SELECT ON TABLE public.business_messages TO authenticated;

GRANT TRIGGER ON TABLE public.business_messages TO authenticated;

GRANT TRUNCATE ON TABLE public.business_messages TO authenticated;

GRANT UPDATE ON TABLE public.business_messages TO authenticated;

GRANT DELETE ON TABLE public.business_messages TO service_role;

GRANT INSERT ON TABLE public.business_messages TO service_role;

GRANT MAINTAIN ON TABLE public.business_messages TO service_role;

GRANT REFERENCES ON TABLE public.business_messages TO service_role;

GRANT SELECT ON TABLE public.business_messages TO service_role;

GRANT TRIGGER ON TABLE public.business_messages TO service_role;

GRANT TRUNCATE ON TABLE public.business_messages TO service_role;

GRANT UPDATE ON TABLE public.business_messages TO service_role;

GRANT DELETE ON TABLE public.business_reviews TO postgres;

GRANT INSERT ON TABLE public.business_reviews TO postgres;

GRANT MAINTAIN ON TABLE public.business_reviews TO postgres;

GRANT REFERENCES ON TABLE public.business_reviews TO postgres;

GRANT SELECT ON TABLE public.business_reviews TO postgres;

GRANT TRIGGER ON TABLE public.business_reviews TO postgres;

GRANT TRUNCATE ON TABLE public.business_reviews TO postgres;

GRANT UPDATE ON TABLE public.business_reviews TO postgres;

GRANT DELETE ON TABLE public.business_reviews TO anon;

GRANT INSERT ON TABLE public.business_reviews TO anon;

GRANT MAINTAIN ON TABLE public.business_reviews TO anon;

GRANT REFERENCES ON TABLE public.business_reviews TO anon;

GRANT SELECT ON TABLE public.business_reviews TO anon;

GRANT TRIGGER ON TABLE public.business_reviews TO anon;

GRANT TRUNCATE ON TABLE public.business_reviews TO anon;

GRANT UPDATE ON TABLE public.business_reviews TO anon;

GRANT DELETE ON TABLE public.business_reviews TO authenticated;

GRANT INSERT ON TABLE public.business_reviews TO authenticated;

GRANT MAINTAIN ON TABLE public.business_reviews TO authenticated;

GRANT REFERENCES ON TABLE public.business_reviews TO authenticated;

GRANT SELECT ON TABLE public.business_reviews TO authenticated;

GRANT TRIGGER ON TABLE public.business_reviews TO authenticated;

GRANT TRUNCATE ON TABLE public.business_reviews TO authenticated;

GRANT UPDATE ON TABLE public.business_reviews TO authenticated;

GRANT DELETE ON TABLE public.business_reviews TO service_role;

GRANT INSERT ON TABLE public.business_reviews TO service_role;

GRANT MAINTAIN ON TABLE public.business_reviews TO service_role;

GRANT REFERENCES ON TABLE public.business_reviews TO service_role;

GRANT SELECT ON TABLE public.business_reviews TO service_role;

GRANT TRIGGER ON TABLE public.business_reviews TO service_role;

GRANT TRUNCATE ON TABLE public.business_reviews TO service_role;

GRANT UPDATE ON TABLE public.business_reviews TO service_role;

GRANT DELETE ON TABLE public.business_staff TO postgres;

GRANT INSERT ON TABLE public.business_staff TO postgres;

GRANT MAINTAIN ON TABLE public.business_staff TO postgres;

GRANT REFERENCES ON TABLE public.business_staff TO postgres;

GRANT SELECT ON TABLE public.business_staff TO postgres;

GRANT TRIGGER ON TABLE public.business_staff TO postgres;

GRANT TRUNCATE ON TABLE public.business_staff TO postgres;

GRANT UPDATE ON TABLE public.business_staff TO postgres;

GRANT DELETE ON TABLE public.business_staff TO anon;

GRANT INSERT ON TABLE public.business_staff TO anon;

GRANT MAINTAIN ON TABLE public.business_staff TO anon;

GRANT REFERENCES ON TABLE public.business_staff TO anon;

GRANT SELECT ON TABLE public.business_staff TO anon;

GRANT TRIGGER ON TABLE public.business_staff TO anon;

GRANT TRUNCATE ON TABLE public.business_staff TO anon;

GRANT UPDATE ON TABLE public.business_staff TO anon;

GRANT DELETE ON TABLE public.business_staff TO authenticated;

GRANT INSERT ON TABLE public.business_staff TO authenticated;

GRANT MAINTAIN ON TABLE public.business_staff TO authenticated;

GRANT REFERENCES ON TABLE public.business_staff TO authenticated;

GRANT SELECT ON TABLE public.business_staff TO authenticated;

GRANT TRIGGER ON TABLE public.business_staff TO authenticated;

GRANT TRUNCATE ON TABLE public.business_staff TO authenticated;

GRANT UPDATE ON TABLE public.business_staff TO authenticated;

GRANT DELETE ON TABLE public.business_staff TO service_role;

GRANT INSERT ON TABLE public.business_staff TO service_role;

GRANT MAINTAIN ON TABLE public.business_staff TO service_role;

GRANT REFERENCES ON TABLE public.business_staff TO service_role;

GRANT SELECT ON TABLE public.business_staff TO service_role;

GRANT TRIGGER ON TABLE public.business_staff TO service_role;

GRANT TRUNCATE ON TABLE public.business_staff TO service_role;

GRANT UPDATE ON TABLE public.business_staff TO service_role;

GRANT DELETE ON TABLE public.businesses TO postgres;

GRANT INSERT ON TABLE public.businesses TO postgres;

GRANT MAINTAIN ON TABLE public.businesses TO postgres;

GRANT REFERENCES ON TABLE public.businesses TO postgres;

GRANT SELECT ON TABLE public.businesses TO postgres;

GRANT TRIGGER ON TABLE public.businesses TO postgres;

GRANT TRUNCATE ON TABLE public.businesses TO postgres;

GRANT UPDATE ON TABLE public.businesses TO postgres;

GRANT DELETE ON TABLE public.businesses TO anon;

GRANT INSERT ON TABLE public.businesses TO anon;

GRANT MAINTAIN ON TABLE public.businesses TO anon;

GRANT REFERENCES ON TABLE public.businesses TO anon;

GRANT SELECT ON TABLE public.businesses TO anon;

GRANT TRIGGER ON TABLE public.businesses TO anon;

GRANT TRUNCATE ON TABLE public.businesses TO anon;

GRANT UPDATE ON TABLE public.businesses TO anon;

GRANT DELETE ON TABLE public.businesses TO authenticated;

GRANT INSERT ON TABLE public.businesses TO authenticated;

GRANT MAINTAIN ON TABLE public.businesses TO authenticated;

GRANT REFERENCES ON TABLE public.businesses TO authenticated;

GRANT SELECT ON TABLE public.businesses TO authenticated;

GRANT TRIGGER ON TABLE public.businesses TO authenticated;

GRANT TRUNCATE ON TABLE public.businesses TO authenticated;

GRANT UPDATE ON TABLE public.businesses TO authenticated;

GRANT DELETE ON TABLE public.businesses TO service_role;

GRANT INSERT ON TABLE public.businesses TO service_role;

GRANT MAINTAIN ON TABLE public.businesses TO service_role;

GRANT REFERENCES ON TABLE public.businesses TO service_role;

GRANT SELECT ON TABLE public.businesses TO service_role;

GRANT TRIGGER ON TABLE public.businesses TO service_role;

GRANT TRUNCATE ON TABLE public.businesses TO service_role;

GRANT UPDATE ON TABLE public.businesses TO service_role;

GRANT DELETE ON TABLE public.catalog_items TO postgres;

GRANT INSERT ON TABLE public.catalog_items TO postgres;

GRANT MAINTAIN ON TABLE public.catalog_items TO postgres;

GRANT REFERENCES ON TABLE public.catalog_items TO postgres;

GRANT SELECT ON TABLE public.catalog_items TO postgres;

GRANT TRIGGER ON TABLE public.catalog_items TO postgres;

GRANT TRUNCATE ON TABLE public.catalog_items TO postgres;

GRANT UPDATE ON TABLE public.catalog_items TO postgres;

GRANT DELETE ON TABLE public.catalog_items TO anon;

GRANT INSERT ON TABLE public.catalog_items TO anon;

GRANT MAINTAIN ON TABLE public.catalog_items TO anon;

GRANT REFERENCES ON TABLE public.catalog_items TO anon;

GRANT SELECT ON TABLE public.catalog_items TO anon;

GRANT TRIGGER ON TABLE public.catalog_items TO anon;

GRANT TRUNCATE ON TABLE public.catalog_items TO anon;

GRANT UPDATE ON TABLE public.catalog_items TO anon;

GRANT DELETE ON TABLE public.catalog_items TO authenticated;

GRANT INSERT ON TABLE public.catalog_items TO authenticated;

GRANT MAINTAIN ON TABLE public.catalog_items TO authenticated;

GRANT REFERENCES ON TABLE public.catalog_items TO authenticated;

GRANT SELECT ON TABLE public.catalog_items TO authenticated;

GRANT TRIGGER ON TABLE public.catalog_items TO authenticated;

GRANT TRUNCATE ON TABLE public.catalog_items TO authenticated;

GRANT UPDATE ON TABLE public.catalog_items TO authenticated;

GRANT DELETE ON TABLE public.catalog_items TO service_role;

GRANT INSERT ON TABLE public.catalog_items TO service_role;

GRANT MAINTAIN ON TABLE public.catalog_items TO service_role;

GRANT REFERENCES ON TABLE public.catalog_items TO service_role;

GRANT SELECT ON TABLE public.catalog_items TO service_role;

GRANT TRIGGER ON TABLE public.catalog_items TO service_role;

GRANT TRUNCATE ON TABLE public.catalog_items TO service_role;

GRANT UPDATE ON TABLE public.catalog_items TO service_role;

GRANT DELETE ON TABLE public.chat_messages TO postgres;

GRANT INSERT ON TABLE public.chat_messages TO postgres;

GRANT MAINTAIN ON TABLE public.chat_messages TO postgres;

GRANT REFERENCES ON TABLE public.chat_messages TO postgres;

GRANT SELECT ON TABLE public.chat_messages TO postgres;

GRANT TRIGGER ON TABLE public.chat_messages TO postgres;

GRANT TRUNCATE ON TABLE public.chat_messages TO postgres;

GRANT UPDATE ON TABLE public.chat_messages TO postgres;

GRANT DELETE ON TABLE public.chat_messages TO anon;

GRANT INSERT ON TABLE public.chat_messages TO anon;

GRANT MAINTAIN ON TABLE public.chat_messages TO anon;

GRANT REFERENCES ON TABLE public.chat_messages TO anon;

GRANT SELECT ON TABLE public.chat_messages TO anon;

GRANT TRIGGER ON TABLE public.chat_messages TO anon;

GRANT TRUNCATE ON TABLE public.chat_messages TO anon;

GRANT UPDATE ON TABLE public.chat_messages TO anon;

GRANT DELETE ON TABLE public.chat_messages TO authenticated;

GRANT INSERT ON TABLE public.chat_messages TO authenticated;

GRANT MAINTAIN ON TABLE public.chat_messages TO authenticated;

GRANT REFERENCES ON TABLE public.chat_messages TO authenticated;

GRANT SELECT ON TABLE public.chat_messages TO authenticated;

GRANT TRIGGER ON TABLE public.chat_messages TO authenticated;

GRANT TRUNCATE ON TABLE public.chat_messages TO authenticated;

GRANT UPDATE ON TABLE public.chat_messages TO authenticated;

GRANT DELETE ON TABLE public.chat_messages TO service_role;

GRANT INSERT ON TABLE public.chat_messages TO service_role;

GRANT MAINTAIN ON TABLE public.chat_messages TO service_role;

GRANT REFERENCES ON TABLE public.chat_messages TO service_role;

GRANT SELECT ON TABLE public.chat_messages TO service_role;

GRANT TRIGGER ON TABLE public.chat_messages TO service_role;

GRANT TRUNCATE ON TABLE public.chat_messages TO service_role;

GRANT UPDATE ON TABLE public.chat_messages TO service_role;

GRANT DELETE ON TABLE public.comment_likes TO postgres;

GRANT INSERT ON TABLE public.comment_likes TO postgres;

GRANT MAINTAIN ON TABLE public.comment_likes TO postgres;

GRANT REFERENCES ON TABLE public.comment_likes TO postgres;

GRANT SELECT ON TABLE public.comment_likes TO postgres;

GRANT TRIGGER ON TABLE public.comment_likes TO postgres;

GRANT TRUNCATE ON TABLE public.comment_likes TO postgres;

GRANT UPDATE ON TABLE public.comment_likes TO postgres;

GRANT DELETE ON TABLE public.comment_likes TO anon;

GRANT INSERT ON TABLE public.comment_likes TO anon;

GRANT MAINTAIN ON TABLE public.comment_likes TO anon;

GRANT REFERENCES ON TABLE public.comment_likes TO anon;

GRANT SELECT ON TABLE public.comment_likes TO anon;

GRANT TRIGGER ON TABLE public.comment_likes TO anon;

GRANT TRUNCATE ON TABLE public.comment_likes TO anon;

GRANT UPDATE ON TABLE public.comment_likes TO anon;

GRANT DELETE ON TABLE public.comment_likes TO authenticated;

GRANT INSERT ON TABLE public.comment_likes TO authenticated;

GRANT MAINTAIN ON TABLE public.comment_likes TO authenticated;

GRANT REFERENCES ON TABLE public.comment_likes TO authenticated;

GRANT SELECT ON TABLE public.comment_likes TO authenticated;

GRANT TRIGGER ON TABLE public.comment_likes TO authenticated;

GRANT TRUNCATE ON TABLE public.comment_likes TO authenticated;

GRANT UPDATE ON TABLE public.comment_likes TO authenticated;

GRANT DELETE ON TABLE public.comment_likes TO service_role;

GRANT INSERT ON TABLE public.comment_likes TO service_role;

GRANT MAINTAIN ON TABLE public.comment_likes TO service_role;

GRANT REFERENCES ON TABLE public.comment_likes TO service_role;

GRANT SELECT ON TABLE public.comment_likes TO service_role;

GRANT TRIGGER ON TABLE public.comment_likes TO service_role;

GRANT TRUNCATE ON TABLE public.comment_likes TO service_role;

GRANT UPDATE ON TABLE public.comment_likes TO service_role;

GRANT DELETE ON TABLE public.comment_reports TO postgres;

GRANT INSERT ON TABLE public.comment_reports TO postgres;

GRANT MAINTAIN ON TABLE public.comment_reports TO postgres;

GRANT REFERENCES ON TABLE public.comment_reports TO postgres;

GRANT SELECT ON TABLE public.comment_reports TO postgres;

GRANT TRIGGER ON TABLE public.comment_reports TO postgres;

GRANT TRUNCATE ON TABLE public.comment_reports TO postgres;

GRANT UPDATE ON TABLE public.comment_reports TO postgres;

GRANT DELETE ON TABLE public.comment_reports TO anon;

GRANT INSERT ON TABLE public.comment_reports TO anon;

GRANT MAINTAIN ON TABLE public.comment_reports TO anon;

GRANT REFERENCES ON TABLE public.comment_reports TO anon;

GRANT SELECT ON TABLE public.comment_reports TO anon;

GRANT TRIGGER ON TABLE public.comment_reports TO anon;

GRANT TRUNCATE ON TABLE public.comment_reports TO anon;

GRANT UPDATE ON TABLE public.comment_reports TO anon;

GRANT DELETE ON TABLE public.comment_reports TO authenticated;

GRANT INSERT ON TABLE public.comment_reports TO authenticated;

GRANT MAINTAIN ON TABLE public.comment_reports TO authenticated;

GRANT REFERENCES ON TABLE public.comment_reports TO authenticated;

GRANT SELECT ON TABLE public.comment_reports TO authenticated;

GRANT TRIGGER ON TABLE public.comment_reports TO authenticated;

GRANT TRUNCATE ON TABLE public.comment_reports TO authenticated;

GRANT UPDATE ON TABLE public.comment_reports TO authenticated;

GRANT DELETE ON TABLE public.comment_reports TO service_role;

GRANT INSERT ON TABLE public.comment_reports TO service_role;

GRANT MAINTAIN ON TABLE public.comment_reports TO service_role;

GRANT REFERENCES ON TABLE public.comment_reports TO service_role;

GRANT SELECT ON TABLE public.comment_reports TO service_role;

GRANT TRIGGER ON TABLE public.comment_reports TO service_role;

GRANT TRUNCATE ON TABLE public.comment_reports TO service_role;

GRANT UPDATE ON TABLE public.comment_reports TO service_role;

GRANT DELETE ON TABLE public.comments TO postgres;

GRANT INSERT ON TABLE public.comments TO postgres;

GRANT MAINTAIN ON TABLE public.comments TO postgres;

GRANT REFERENCES ON TABLE public.comments TO postgres;

GRANT SELECT ON TABLE public.comments TO postgres;

GRANT TRIGGER ON TABLE public.comments TO postgres;

GRANT TRUNCATE ON TABLE public.comments TO postgres;

GRANT UPDATE ON TABLE public.comments TO postgres;

GRANT DELETE ON TABLE public.comments TO anon;

GRANT INSERT ON TABLE public.comments TO anon;

GRANT MAINTAIN ON TABLE public.comments TO anon;

GRANT REFERENCES ON TABLE public.comments TO anon;

GRANT SELECT ON TABLE public.comments TO anon;

GRANT TRIGGER ON TABLE public.comments TO anon;

GRANT TRUNCATE ON TABLE public.comments TO anon;

GRANT UPDATE ON TABLE public.comments TO anon;

GRANT DELETE ON TABLE public.comments TO authenticated;

GRANT INSERT ON TABLE public.comments TO authenticated;

GRANT MAINTAIN ON TABLE public.comments TO authenticated;

GRANT REFERENCES ON TABLE public.comments TO authenticated;

GRANT SELECT ON TABLE public.comments TO authenticated;

GRANT TRIGGER ON TABLE public.comments TO authenticated;

GRANT TRUNCATE ON TABLE public.comments TO authenticated;

GRANT UPDATE ON TABLE public.comments TO authenticated;

GRANT DELETE ON TABLE public.comments TO service_role;

GRANT INSERT ON TABLE public.comments TO service_role;

GRANT MAINTAIN ON TABLE public.comments TO service_role;

GRANT REFERENCES ON TABLE public.comments TO service_role;

GRANT SELECT ON TABLE public.comments TO service_role;

GRANT TRIGGER ON TABLE public.comments TO service_role;

GRANT TRUNCATE ON TABLE public.comments TO service_role;

GRANT UPDATE ON TABLE public.comments TO service_role;

GRANT DELETE ON TABLE public.communities TO postgres;

GRANT INSERT ON TABLE public.communities TO postgres;

GRANT MAINTAIN ON TABLE public.communities TO postgres;

GRANT REFERENCES ON TABLE public.communities TO postgres;

GRANT SELECT ON TABLE public.communities TO postgres;

GRANT TRIGGER ON TABLE public.communities TO postgres;

GRANT TRUNCATE ON TABLE public.communities TO postgres;

GRANT UPDATE ON TABLE public.communities TO postgres;

GRANT DELETE ON TABLE public.communities TO anon;

GRANT INSERT ON TABLE public.communities TO anon;

GRANT MAINTAIN ON TABLE public.communities TO anon;

GRANT REFERENCES ON TABLE public.communities TO anon;

GRANT SELECT ON TABLE public.communities TO anon;

GRANT TRIGGER ON TABLE public.communities TO anon;

GRANT TRUNCATE ON TABLE public.communities TO anon;

GRANT UPDATE ON TABLE public.communities TO anon;

GRANT DELETE ON TABLE public.communities TO authenticated;

GRANT INSERT ON TABLE public.communities TO authenticated;

GRANT MAINTAIN ON TABLE public.communities TO authenticated;

GRANT REFERENCES ON TABLE public.communities TO authenticated;

GRANT SELECT ON TABLE public.communities TO authenticated;

GRANT TRIGGER ON TABLE public.communities TO authenticated;

GRANT TRUNCATE ON TABLE public.communities TO authenticated;

GRANT UPDATE ON TABLE public.communities TO authenticated;

GRANT DELETE ON TABLE public.communities TO service_role;

GRANT INSERT ON TABLE public.communities TO service_role;

GRANT MAINTAIN ON TABLE public.communities TO service_role;

GRANT REFERENCES ON TABLE public.communities TO service_role;

GRANT SELECT ON TABLE public.communities TO service_role;

GRANT TRIGGER ON TABLE public.communities TO service_role;

GRANT TRUNCATE ON TABLE public.communities TO service_role;

GRANT UPDATE ON TABLE public.communities TO service_role;

GRANT DELETE ON TABLE public.community_comment_likes TO postgres;

GRANT INSERT ON TABLE public.community_comment_likes TO postgres;

GRANT MAINTAIN ON TABLE public.community_comment_likes TO postgres;

GRANT REFERENCES ON TABLE public.community_comment_likes TO postgres;

GRANT SELECT ON TABLE public.community_comment_likes TO postgres;

GRANT TRIGGER ON TABLE public.community_comment_likes TO postgres;

GRANT TRUNCATE ON TABLE public.community_comment_likes TO postgres;

GRANT UPDATE ON TABLE public.community_comment_likes TO postgres;

GRANT DELETE ON TABLE public.community_comment_likes TO anon;

GRANT INSERT ON TABLE public.community_comment_likes TO anon;

GRANT MAINTAIN ON TABLE public.community_comment_likes TO anon;

GRANT REFERENCES ON TABLE public.community_comment_likes TO anon;

GRANT SELECT ON TABLE public.community_comment_likes TO anon;

GRANT TRIGGER ON TABLE public.community_comment_likes TO anon;

GRANT TRUNCATE ON TABLE public.community_comment_likes TO anon;

GRANT UPDATE ON TABLE public.community_comment_likes TO anon;

GRANT DELETE ON TABLE public.community_comment_likes TO authenticated;

GRANT INSERT ON TABLE public.community_comment_likes TO authenticated;

GRANT MAINTAIN ON TABLE public.community_comment_likes TO authenticated;

GRANT REFERENCES ON TABLE public.community_comment_likes TO authenticated;

GRANT SELECT ON TABLE public.community_comment_likes TO authenticated;

GRANT TRIGGER ON TABLE public.community_comment_likes TO authenticated;

GRANT TRUNCATE ON TABLE public.community_comment_likes TO authenticated;

GRANT UPDATE ON TABLE public.community_comment_likes TO authenticated;

GRANT DELETE ON TABLE public.community_comment_likes TO service_role;

GRANT INSERT ON TABLE public.community_comment_likes TO service_role;

GRANT MAINTAIN ON TABLE public.community_comment_likes TO service_role;

GRANT REFERENCES ON TABLE public.community_comment_likes TO service_role;

GRANT SELECT ON TABLE public.community_comment_likes TO service_role;

GRANT TRIGGER ON TABLE public.community_comment_likes TO service_role;

GRANT TRUNCATE ON TABLE public.community_comment_likes TO service_role;

GRANT UPDATE ON TABLE public.community_comment_likes TO service_role;

GRANT DELETE ON TABLE public.community_comments TO postgres;

GRANT INSERT ON TABLE public.community_comments TO postgres;

GRANT MAINTAIN ON TABLE public.community_comments TO postgres;

GRANT REFERENCES ON TABLE public.community_comments TO postgres;

GRANT SELECT ON TABLE public.community_comments TO postgres;

GRANT TRIGGER ON TABLE public.community_comments TO postgres;

GRANT TRUNCATE ON TABLE public.community_comments TO postgres;

GRANT UPDATE ON TABLE public.community_comments TO postgres;

GRANT DELETE ON TABLE public.community_comments TO anon;

GRANT INSERT ON TABLE public.community_comments TO anon;

GRANT MAINTAIN ON TABLE public.community_comments TO anon;

GRANT REFERENCES ON TABLE public.community_comments TO anon;

GRANT SELECT ON TABLE public.community_comments TO anon;

GRANT TRIGGER ON TABLE public.community_comments TO anon;

GRANT TRUNCATE ON TABLE public.community_comments TO anon;

GRANT UPDATE ON TABLE public.community_comments TO anon;

GRANT DELETE ON TABLE public.community_comments TO authenticated;

GRANT INSERT ON TABLE public.community_comments TO authenticated;

GRANT MAINTAIN ON TABLE public.community_comments TO authenticated;

GRANT REFERENCES ON TABLE public.community_comments TO authenticated;

GRANT SELECT ON TABLE public.community_comments TO authenticated;

GRANT TRIGGER ON TABLE public.community_comments TO authenticated;

GRANT TRUNCATE ON TABLE public.community_comments TO authenticated;

GRANT UPDATE ON TABLE public.community_comments TO authenticated;

GRANT DELETE ON TABLE public.community_comments TO service_role;

GRANT INSERT ON TABLE public.community_comments TO service_role;

GRANT MAINTAIN ON TABLE public.community_comments TO service_role;

GRANT REFERENCES ON TABLE public.community_comments TO service_role;

GRANT SELECT ON TABLE public.community_comments TO service_role;

GRANT TRIGGER ON TABLE public.community_comments TO service_role;

GRANT TRUNCATE ON TABLE public.community_comments TO service_role;

GRANT UPDATE ON TABLE public.community_comments TO service_role;

GRANT DELETE ON TABLE public.community_invites TO postgres;

GRANT INSERT ON TABLE public.community_invites TO postgres;

GRANT MAINTAIN ON TABLE public.community_invites TO postgres;

GRANT REFERENCES ON TABLE public.community_invites TO postgres;

GRANT SELECT ON TABLE public.community_invites TO postgres;

GRANT TRIGGER ON TABLE public.community_invites TO postgres;

GRANT TRUNCATE ON TABLE public.community_invites TO postgres;

GRANT UPDATE ON TABLE public.community_invites TO postgres;

GRANT DELETE ON TABLE public.community_invites TO anon;

GRANT INSERT ON TABLE public.community_invites TO anon;

GRANT MAINTAIN ON TABLE public.community_invites TO anon;

GRANT REFERENCES ON TABLE public.community_invites TO anon;

GRANT SELECT ON TABLE public.community_invites TO anon;

GRANT TRIGGER ON TABLE public.community_invites TO anon;

GRANT TRUNCATE ON TABLE public.community_invites TO anon;

GRANT UPDATE ON TABLE public.community_invites TO anon;

GRANT DELETE ON TABLE public.community_invites TO authenticated;

GRANT INSERT ON TABLE public.community_invites TO authenticated;

GRANT MAINTAIN ON TABLE public.community_invites TO authenticated;

GRANT REFERENCES ON TABLE public.community_invites TO authenticated;

GRANT SELECT ON TABLE public.community_invites TO authenticated;

GRANT TRIGGER ON TABLE public.community_invites TO authenticated;

GRANT TRUNCATE ON TABLE public.community_invites TO authenticated;

GRANT UPDATE ON TABLE public.community_invites TO authenticated;

GRANT DELETE ON TABLE public.community_invites TO service_role;

GRANT INSERT ON TABLE public.community_invites TO service_role;

GRANT MAINTAIN ON TABLE public.community_invites TO service_role;

GRANT REFERENCES ON TABLE public.community_invites TO service_role;

GRANT SELECT ON TABLE public.community_invites TO service_role;

GRANT TRIGGER ON TABLE public.community_invites TO service_role;

GRANT TRUNCATE ON TABLE public.community_invites TO service_role;

GRANT UPDATE ON TABLE public.community_invites TO service_role;

GRANT DELETE ON TABLE public.community_join_requests TO postgres;

GRANT INSERT ON TABLE public.community_join_requests TO postgres;

GRANT MAINTAIN ON TABLE public.community_join_requests TO postgres;

GRANT REFERENCES ON TABLE public.community_join_requests TO postgres;

GRANT SELECT ON TABLE public.community_join_requests TO postgres;

GRANT TRIGGER ON TABLE public.community_join_requests TO postgres;

GRANT TRUNCATE ON TABLE public.community_join_requests TO postgres;

GRANT UPDATE ON TABLE public.community_join_requests TO postgres;

GRANT DELETE ON TABLE public.community_join_requests TO anon;

GRANT INSERT ON TABLE public.community_join_requests TO anon;

GRANT MAINTAIN ON TABLE public.community_join_requests TO anon;

GRANT REFERENCES ON TABLE public.community_join_requests TO anon;

GRANT SELECT ON TABLE public.community_join_requests TO anon;

GRANT TRIGGER ON TABLE public.community_join_requests TO anon;

GRANT TRUNCATE ON TABLE public.community_join_requests TO anon;

GRANT UPDATE ON TABLE public.community_join_requests TO anon;

GRANT DELETE ON TABLE public.community_join_requests TO authenticated;

GRANT INSERT ON TABLE public.community_join_requests TO authenticated;

GRANT MAINTAIN ON TABLE public.community_join_requests TO authenticated;

GRANT REFERENCES ON TABLE public.community_join_requests TO authenticated;

GRANT SELECT ON TABLE public.community_join_requests TO authenticated;

GRANT TRIGGER ON TABLE public.community_join_requests TO authenticated;

GRANT TRUNCATE ON TABLE public.community_join_requests TO authenticated;

GRANT UPDATE ON TABLE public.community_join_requests TO authenticated;

GRANT DELETE ON TABLE public.community_join_requests TO service_role;

GRANT INSERT ON TABLE public.community_join_requests TO service_role;

GRANT MAINTAIN ON TABLE public.community_join_requests TO service_role;

GRANT REFERENCES ON TABLE public.community_join_requests TO service_role;

GRANT SELECT ON TABLE public.community_join_requests TO service_role;

GRANT TRIGGER ON TABLE public.community_join_requests TO service_role;

GRANT TRUNCATE ON TABLE public.community_join_requests TO service_role;

GRANT UPDATE ON TABLE public.community_join_requests TO service_role;

GRANT DELETE ON TABLE public.community_memberships TO postgres;

GRANT INSERT ON TABLE public.community_memberships TO postgres;

GRANT MAINTAIN ON TABLE public.community_memberships TO postgres;

GRANT REFERENCES ON TABLE public.community_memberships TO postgres;

GRANT SELECT ON TABLE public.community_memberships TO postgres;

GRANT TRIGGER ON TABLE public.community_memberships TO postgres;

GRANT TRUNCATE ON TABLE public.community_memberships TO postgres;

GRANT UPDATE ON TABLE public.community_memberships TO postgres;

GRANT DELETE ON TABLE public.community_memberships TO anon;

GRANT INSERT ON TABLE public.community_memberships TO anon;

GRANT MAINTAIN ON TABLE public.community_memberships TO anon;

GRANT REFERENCES ON TABLE public.community_memberships TO anon;

GRANT SELECT ON TABLE public.community_memberships TO anon;

GRANT TRIGGER ON TABLE public.community_memberships TO anon;

GRANT TRUNCATE ON TABLE public.community_memberships TO anon;

GRANT UPDATE ON TABLE public.community_memberships TO anon;

GRANT DELETE ON TABLE public.community_memberships TO authenticated;

GRANT INSERT ON TABLE public.community_memberships TO authenticated;

GRANT MAINTAIN ON TABLE public.community_memberships TO authenticated;

GRANT REFERENCES ON TABLE public.community_memberships TO authenticated;

GRANT SELECT ON TABLE public.community_memberships TO authenticated;

GRANT TRIGGER ON TABLE public.community_memberships TO authenticated;

GRANT TRUNCATE ON TABLE public.community_memberships TO authenticated;

GRANT UPDATE ON TABLE public.community_memberships TO authenticated;

GRANT DELETE ON TABLE public.community_memberships TO service_role;

GRANT INSERT ON TABLE public.community_memberships TO service_role;

GRANT MAINTAIN ON TABLE public.community_memberships TO service_role;

GRANT REFERENCES ON TABLE public.community_memberships TO service_role;

GRANT SELECT ON TABLE public.community_memberships TO service_role;

GRANT TRIGGER ON TABLE public.community_memberships TO service_role;

GRANT TRUNCATE ON TABLE public.community_memberships TO service_role;

GRANT UPDATE ON TABLE public.community_memberships TO service_role;

GRANT DELETE ON TABLE public.community_post_likes TO postgres;

GRANT INSERT ON TABLE public.community_post_likes TO postgres;

GRANT MAINTAIN ON TABLE public.community_post_likes TO postgres;

GRANT REFERENCES ON TABLE public.community_post_likes TO postgres;

GRANT SELECT ON TABLE public.community_post_likes TO postgres;

GRANT TRIGGER ON TABLE public.community_post_likes TO postgres;

GRANT TRUNCATE ON TABLE public.community_post_likes TO postgres;

GRANT UPDATE ON TABLE public.community_post_likes TO postgres;

GRANT DELETE ON TABLE public.community_post_likes TO anon;

GRANT INSERT ON TABLE public.community_post_likes TO anon;

GRANT MAINTAIN ON TABLE public.community_post_likes TO anon;

GRANT REFERENCES ON TABLE public.community_post_likes TO anon;

GRANT SELECT ON TABLE public.community_post_likes TO anon;

GRANT TRIGGER ON TABLE public.community_post_likes TO anon;

GRANT TRUNCATE ON TABLE public.community_post_likes TO anon;

GRANT UPDATE ON TABLE public.community_post_likes TO anon;

GRANT DELETE ON TABLE public.community_post_likes TO authenticated;

GRANT INSERT ON TABLE public.community_post_likes TO authenticated;

GRANT MAINTAIN ON TABLE public.community_post_likes TO authenticated;

GRANT REFERENCES ON TABLE public.community_post_likes TO authenticated;

GRANT SELECT ON TABLE public.community_post_likes TO authenticated;

GRANT TRIGGER ON TABLE public.community_post_likes TO authenticated;

GRANT TRUNCATE ON TABLE public.community_post_likes TO authenticated;

GRANT UPDATE ON TABLE public.community_post_likes TO authenticated;

GRANT DELETE ON TABLE public.community_post_likes TO service_role;

GRANT INSERT ON TABLE public.community_post_likes TO service_role;

GRANT MAINTAIN ON TABLE public.community_post_likes TO service_role;

GRANT REFERENCES ON TABLE public.community_post_likes TO service_role;

GRANT SELECT ON TABLE public.community_post_likes TO service_role;

GRANT TRIGGER ON TABLE public.community_post_likes TO service_role;

GRANT TRUNCATE ON TABLE public.community_post_likes TO service_role;

GRANT UPDATE ON TABLE public.community_post_likes TO service_role;

GRANT DELETE ON TABLE public.community_posts TO postgres;

GRANT INSERT ON TABLE public.community_posts TO postgres;

GRANT MAINTAIN ON TABLE public.community_posts TO postgres;

GRANT REFERENCES ON TABLE public.community_posts TO postgres;

GRANT SELECT ON TABLE public.community_posts TO postgres;

GRANT TRIGGER ON TABLE public.community_posts TO postgres;

GRANT TRUNCATE ON TABLE public.community_posts TO postgres;

GRANT UPDATE ON TABLE public.community_posts TO postgres;

GRANT DELETE ON TABLE public.community_posts TO anon;

GRANT INSERT ON TABLE public.community_posts TO anon;

GRANT MAINTAIN ON TABLE public.community_posts TO anon;

GRANT REFERENCES ON TABLE public.community_posts TO anon;

GRANT SELECT ON TABLE public.community_posts TO anon;

GRANT TRIGGER ON TABLE public.community_posts TO anon;

GRANT TRUNCATE ON TABLE public.community_posts TO anon;

GRANT UPDATE ON TABLE public.community_posts TO anon;

GRANT DELETE ON TABLE public.community_posts TO authenticated;

GRANT INSERT ON TABLE public.community_posts TO authenticated;

GRANT MAINTAIN ON TABLE public.community_posts TO authenticated;

GRANT REFERENCES ON TABLE public.community_posts TO authenticated;

GRANT SELECT ON TABLE public.community_posts TO authenticated;

GRANT TRIGGER ON TABLE public.community_posts TO authenticated;

GRANT TRUNCATE ON TABLE public.community_posts TO authenticated;

GRANT UPDATE ON TABLE public.community_posts TO authenticated;

GRANT DELETE ON TABLE public.community_posts TO service_role;

GRANT INSERT ON TABLE public.community_posts TO service_role;

GRANT MAINTAIN ON TABLE public.community_posts TO service_role;

GRANT REFERENCES ON TABLE public.community_posts TO service_role;

GRANT SELECT ON TABLE public.community_posts TO service_role;

GRANT TRIGGER ON TABLE public.community_posts TO service_role;

GRANT TRUNCATE ON TABLE public.community_posts TO service_role;

GRANT UPDATE ON TABLE public.community_posts TO service_role;

GRANT DELETE ON TABLE public.conversations TO postgres;

GRANT INSERT ON TABLE public.conversations TO postgres;

GRANT MAINTAIN ON TABLE public.conversations TO postgres;

GRANT REFERENCES ON TABLE public.conversations TO postgres;

GRANT SELECT ON TABLE public.conversations TO postgres;

GRANT TRIGGER ON TABLE public.conversations TO postgres;

GRANT TRUNCATE ON TABLE public.conversations TO postgres;

GRANT UPDATE ON TABLE public.conversations TO postgres;

GRANT DELETE ON TABLE public.conversations TO anon;

GRANT INSERT ON TABLE public.conversations TO anon;

GRANT MAINTAIN ON TABLE public.conversations TO anon;

GRANT REFERENCES ON TABLE public.conversations TO anon;

GRANT SELECT ON TABLE public.conversations TO anon;

GRANT TRIGGER ON TABLE public.conversations TO anon;

GRANT TRUNCATE ON TABLE public.conversations TO anon;

GRANT UPDATE ON TABLE public.conversations TO anon;

GRANT DELETE ON TABLE public.conversations TO authenticated;

GRANT INSERT ON TABLE public.conversations TO authenticated;

GRANT MAINTAIN ON TABLE public.conversations TO authenticated;

GRANT REFERENCES ON TABLE public.conversations TO authenticated;

GRANT SELECT ON TABLE public.conversations TO authenticated;

GRANT TRIGGER ON TABLE public.conversations TO authenticated;

GRANT TRUNCATE ON TABLE public.conversations TO authenticated;

GRANT UPDATE ON TABLE public.conversations TO authenticated;

GRANT DELETE ON TABLE public.conversations TO service_role;

GRANT INSERT ON TABLE public.conversations TO service_role;

GRANT MAINTAIN ON TABLE public.conversations TO service_role;

GRANT REFERENCES ON TABLE public.conversations TO service_role;

GRANT SELECT ON TABLE public.conversations TO service_role;

GRANT TRIGGER ON TABLE public.conversations TO service_role;

GRANT TRUNCATE ON TABLE public.conversations TO service_role;

GRANT UPDATE ON TABLE public.conversations TO service_role;

GRANT DELETE ON TABLE public.dispute_resolution_operations TO postgres;

GRANT INSERT ON TABLE public.dispute_resolution_operations TO postgres;

GRANT MAINTAIN ON TABLE public.dispute_resolution_operations TO postgres;

GRANT REFERENCES ON TABLE public.dispute_resolution_operations TO postgres;

GRANT SELECT ON TABLE public.dispute_resolution_operations TO postgres;

GRANT TRIGGER ON TABLE public.dispute_resolution_operations TO postgres;

GRANT TRUNCATE ON TABLE public.dispute_resolution_operations TO postgres;

GRANT UPDATE ON TABLE public.dispute_resolution_operations TO postgres;

GRANT DELETE ON TABLE public.dispute_resolution_operations TO service_role;

GRANT INSERT ON TABLE public.dispute_resolution_operations TO service_role;

GRANT MAINTAIN ON TABLE public.dispute_resolution_operations TO service_role;

GRANT REFERENCES ON TABLE public.dispute_resolution_operations TO service_role;

GRANT SELECT ON TABLE public.dispute_resolution_operations TO service_role;

GRANT TRIGGER ON TABLE public.dispute_resolution_operations TO service_role;

GRANT TRUNCATE ON TABLE public.dispute_resolution_operations TO service_role;

GRANT UPDATE ON TABLE public.dispute_resolution_operations TO service_role;

GRANT DELETE ON TABLE public.disputes TO postgres;

GRANT INSERT ON TABLE public.disputes TO postgres;

GRANT MAINTAIN ON TABLE public.disputes TO postgres;

GRANT REFERENCES ON TABLE public.disputes TO postgres;

GRANT SELECT ON TABLE public.disputes TO postgres;

GRANT TRIGGER ON TABLE public.disputes TO postgres;

GRANT TRUNCATE ON TABLE public.disputes TO postgres;

GRANT UPDATE ON TABLE public.disputes TO postgres;

GRANT DELETE ON TABLE public.disputes TO service_role;

GRANT INSERT ON TABLE public.disputes TO service_role;

GRANT MAINTAIN ON TABLE public.disputes TO service_role;

GRANT REFERENCES ON TABLE public.disputes TO service_role;

GRANT SELECT ON TABLE public.disputes TO service_role;

GRANT TRIGGER ON TABLE public.disputes TO service_role;

GRANT TRUNCATE ON TABLE public.disputes TO service_role;

GRANT UPDATE ON TABLE public.disputes TO service_role;

GRANT DELETE ON TABLE public.escrow_transactions TO postgres;

GRANT INSERT ON TABLE public.escrow_transactions TO postgres;

GRANT MAINTAIN ON TABLE public.escrow_transactions TO postgres;

GRANT REFERENCES ON TABLE public.escrow_transactions TO postgres;

GRANT SELECT ON TABLE public.escrow_transactions TO postgres;

GRANT TRIGGER ON TABLE public.escrow_transactions TO postgres;

GRANT TRUNCATE ON TABLE public.escrow_transactions TO postgres;

GRANT UPDATE ON TABLE public.escrow_transactions TO postgres;

GRANT DELETE ON TABLE public.escrow_transactions TO anon;

GRANT INSERT ON TABLE public.escrow_transactions TO anon;

GRANT MAINTAIN ON TABLE public.escrow_transactions TO anon;

GRANT REFERENCES ON TABLE public.escrow_transactions TO anon;

GRANT SELECT ON TABLE public.escrow_transactions TO anon;

GRANT TRIGGER ON TABLE public.escrow_transactions TO anon;

GRANT TRUNCATE ON TABLE public.escrow_transactions TO anon;

GRANT UPDATE ON TABLE public.escrow_transactions TO anon;

GRANT DELETE ON TABLE public.escrow_transactions TO authenticated;

GRANT INSERT ON TABLE public.escrow_transactions TO authenticated;

GRANT MAINTAIN ON TABLE public.escrow_transactions TO authenticated;

GRANT REFERENCES ON TABLE public.escrow_transactions TO authenticated;

GRANT SELECT ON TABLE public.escrow_transactions TO authenticated;

GRANT TRIGGER ON TABLE public.escrow_transactions TO authenticated;

GRANT TRUNCATE ON TABLE public.escrow_transactions TO authenticated;

GRANT UPDATE ON TABLE public.escrow_transactions TO authenticated;

GRANT DELETE ON TABLE public.escrow_transactions TO service_role;

GRANT INSERT ON TABLE public.escrow_transactions TO service_role;

GRANT MAINTAIN ON TABLE public.escrow_transactions TO service_role;

GRANT REFERENCES ON TABLE public.escrow_transactions TO service_role;

GRANT SELECT ON TABLE public.escrow_transactions TO service_role;

GRANT TRIGGER ON TABLE public.escrow_transactions TO service_role;

GRANT TRUNCATE ON TABLE public.escrow_transactions TO service_role;

GRANT UPDATE ON TABLE public.escrow_transactions TO service_role;

GRANT DELETE ON TABLE public.event_bookmarks TO postgres;

GRANT INSERT ON TABLE public.event_bookmarks TO postgres;

GRANT MAINTAIN ON TABLE public.event_bookmarks TO postgres;

GRANT REFERENCES ON TABLE public.event_bookmarks TO postgres;

GRANT SELECT ON TABLE public.event_bookmarks TO postgres;

GRANT TRIGGER ON TABLE public.event_bookmarks TO postgres;

GRANT TRUNCATE ON TABLE public.event_bookmarks TO postgres;

GRANT UPDATE ON TABLE public.event_bookmarks TO postgres;

GRANT DELETE ON TABLE public.event_bookmarks TO anon;

GRANT INSERT ON TABLE public.event_bookmarks TO anon;

GRANT MAINTAIN ON TABLE public.event_bookmarks TO anon;

GRANT REFERENCES ON TABLE public.event_bookmarks TO anon;

GRANT SELECT ON TABLE public.event_bookmarks TO anon;

GRANT TRIGGER ON TABLE public.event_bookmarks TO anon;

GRANT TRUNCATE ON TABLE public.event_bookmarks TO anon;

GRANT UPDATE ON TABLE public.event_bookmarks TO anon;

GRANT DELETE ON TABLE public.event_bookmarks TO authenticated;

GRANT INSERT ON TABLE public.event_bookmarks TO authenticated;

GRANT MAINTAIN ON TABLE public.event_bookmarks TO authenticated;

GRANT REFERENCES ON TABLE public.event_bookmarks TO authenticated;

GRANT SELECT ON TABLE public.event_bookmarks TO authenticated;

GRANT TRIGGER ON TABLE public.event_bookmarks TO authenticated;

GRANT TRUNCATE ON TABLE public.event_bookmarks TO authenticated;

GRANT UPDATE ON TABLE public.event_bookmarks TO authenticated;

GRANT DELETE ON TABLE public.event_bookmarks TO service_role;

GRANT INSERT ON TABLE public.event_bookmarks TO service_role;

GRANT MAINTAIN ON TABLE public.event_bookmarks TO service_role;

GRANT REFERENCES ON TABLE public.event_bookmarks TO service_role;

GRANT SELECT ON TABLE public.event_bookmarks TO service_role;

GRANT TRIGGER ON TABLE public.event_bookmarks TO service_role;

GRANT TRUNCATE ON TABLE public.event_bookmarks TO service_role;

GRANT UPDATE ON TABLE public.event_bookmarks TO service_role;

GRANT DELETE ON TABLE public.event_payouts TO postgres;

GRANT INSERT ON TABLE public.event_payouts TO postgres;

GRANT MAINTAIN ON TABLE public.event_payouts TO postgres;

GRANT REFERENCES ON TABLE public.event_payouts TO postgres;

GRANT SELECT ON TABLE public.event_payouts TO postgres;

GRANT TRIGGER ON TABLE public.event_payouts TO postgres;

GRANT TRUNCATE ON TABLE public.event_payouts TO postgres;

GRANT UPDATE ON TABLE public.event_payouts TO postgres;

GRANT DELETE ON TABLE public.event_payouts TO anon;

GRANT INSERT ON TABLE public.event_payouts TO anon;

GRANT MAINTAIN ON TABLE public.event_payouts TO anon;

GRANT REFERENCES ON TABLE public.event_payouts TO anon;

GRANT SELECT ON TABLE public.event_payouts TO anon;

GRANT TRIGGER ON TABLE public.event_payouts TO anon;

GRANT TRUNCATE ON TABLE public.event_payouts TO anon;

GRANT UPDATE ON TABLE public.event_payouts TO anon;

GRANT DELETE ON TABLE public.event_payouts TO authenticated;

GRANT INSERT ON TABLE public.event_payouts TO authenticated;

GRANT MAINTAIN ON TABLE public.event_payouts TO authenticated;

GRANT REFERENCES ON TABLE public.event_payouts TO authenticated;

GRANT SELECT ON TABLE public.event_payouts TO authenticated;

GRANT TRIGGER ON TABLE public.event_payouts TO authenticated;

GRANT TRUNCATE ON TABLE public.event_payouts TO authenticated;

GRANT UPDATE ON TABLE public.event_payouts TO authenticated;

GRANT DELETE ON TABLE public.event_payouts TO service_role;

GRANT INSERT ON TABLE public.event_payouts TO service_role;

GRANT MAINTAIN ON TABLE public.event_payouts TO service_role;

GRANT REFERENCES ON TABLE public.event_payouts TO service_role;

GRANT SELECT ON TABLE public.event_payouts TO service_role;

GRANT TRIGGER ON TABLE public.event_payouts TO service_role;

GRANT TRUNCATE ON TABLE public.event_payouts TO service_role;

GRANT UPDATE ON TABLE public.event_payouts TO service_role;

GRANT DELETE ON TABLE public.events TO postgres;

GRANT INSERT ON TABLE public.events TO postgres;

GRANT MAINTAIN ON TABLE public.events TO postgres;

GRANT REFERENCES ON TABLE public.events TO postgres;

GRANT SELECT ON TABLE public.events TO postgres;

GRANT TRIGGER ON TABLE public.events TO postgres;

GRANT TRUNCATE ON TABLE public.events TO postgres;

GRANT UPDATE ON TABLE public.events TO postgres;

GRANT DELETE ON TABLE public.events TO anon;

GRANT INSERT ON TABLE public.events TO anon;

GRANT MAINTAIN ON TABLE public.events TO anon;

GRANT REFERENCES ON TABLE public.events TO anon;

GRANT SELECT ON TABLE public.events TO anon;

GRANT TRIGGER ON TABLE public.events TO anon;

GRANT TRUNCATE ON TABLE public.events TO anon;

GRANT UPDATE ON TABLE public.events TO anon;

GRANT DELETE ON TABLE public.events TO authenticated;

GRANT INSERT ON TABLE public.events TO authenticated;

GRANT MAINTAIN ON TABLE public.events TO authenticated;

GRANT REFERENCES ON TABLE public.events TO authenticated;

GRANT SELECT ON TABLE public.events TO authenticated;

GRANT TRIGGER ON TABLE public.events TO authenticated;

GRANT TRUNCATE ON TABLE public.events TO authenticated;

GRANT UPDATE ON TABLE public.events TO authenticated;

GRANT DELETE ON TABLE public.events TO service_role;

GRANT INSERT ON TABLE public.events TO service_role;

GRANT MAINTAIN ON TABLE public.events TO service_role;

GRANT REFERENCES ON TABLE public.events TO service_role;

GRANT SELECT ON TABLE public.events TO service_role;

GRANT TRIGGER ON TABLE public.events TO service_role;

GRANT TRUNCATE ON TABLE public.events TO service_role;

GRANT UPDATE ON TABLE public.events TO service_role;

GRANT DELETE ON TABLE public.followers TO postgres;

GRANT INSERT ON TABLE public.followers TO postgres;

GRANT MAINTAIN ON TABLE public.followers TO postgres;

GRANT REFERENCES ON TABLE public.followers TO postgres;

GRANT SELECT ON TABLE public.followers TO postgres;

GRANT TRIGGER ON TABLE public.followers TO postgres;

GRANT TRUNCATE ON TABLE public.followers TO postgres;

GRANT UPDATE ON TABLE public.followers TO postgres;

GRANT DELETE ON TABLE public.followers TO anon;

GRANT INSERT ON TABLE public.followers TO anon;

GRANT MAINTAIN ON TABLE public.followers TO anon;

GRANT REFERENCES ON TABLE public.followers TO anon;

GRANT SELECT ON TABLE public.followers TO anon;

GRANT TRIGGER ON TABLE public.followers TO anon;

GRANT TRUNCATE ON TABLE public.followers TO anon;

GRANT UPDATE ON TABLE public.followers TO anon;

GRANT DELETE ON TABLE public.followers TO authenticated;

GRANT INSERT ON TABLE public.followers TO authenticated;

GRANT MAINTAIN ON TABLE public.followers TO authenticated;

GRANT REFERENCES ON TABLE public.followers TO authenticated;

GRANT SELECT ON TABLE public.followers TO authenticated;

GRANT TRIGGER ON TABLE public.followers TO authenticated;

GRANT TRUNCATE ON TABLE public.followers TO authenticated;

GRANT UPDATE ON TABLE public.followers TO authenticated;

GRANT DELETE ON TABLE public.followers TO service_role;

GRANT INSERT ON TABLE public.followers TO service_role;

GRANT MAINTAIN ON TABLE public.followers TO service_role;

GRANT REFERENCES ON TABLE public.followers TO service_role;

GRANT SELECT ON TABLE public.followers TO service_role;

GRANT TRIGGER ON TABLE public.followers TO service_role;

GRANT TRUNCATE ON TABLE public.followers TO service_role;

GRANT UPDATE ON TABLE public.followers TO service_role;

GRANT DELETE ON TABLE public.friend_requests TO postgres;

GRANT INSERT ON TABLE public.friend_requests TO postgres;

GRANT MAINTAIN ON TABLE public.friend_requests TO postgres;

GRANT REFERENCES ON TABLE public.friend_requests TO postgres;

GRANT SELECT ON TABLE public.friend_requests TO postgres;

GRANT TRIGGER ON TABLE public.friend_requests TO postgres;

GRANT TRUNCATE ON TABLE public.friend_requests TO postgres;

GRANT UPDATE ON TABLE public.friend_requests TO postgres;

GRANT DELETE ON TABLE public.friend_requests TO anon;

GRANT INSERT ON TABLE public.friend_requests TO anon;

GRANT MAINTAIN ON TABLE public.friend_requests TO anon;

GRANT REFERENCES ON TABLE public.friend_requests TO anon;

GRANT SELECT ON TABLE public.friend_requests TO anon;

GRANT TRIGGER ON TABLE public.friend_requests TO anon;

GRANT TRUNCATE ON TABLE public.friend_requests TO anon;

GRANT UPDATE ON TABLE public.friend_requests TO anon;

GRANT DELETE ON TABLE public.friend_requests TO authenticated;

GRANT INSERT ON TABLE public.friend_requests TO authenticated;

GRANT MAINTAIN ON TABLE public.friend_requests TO authenticated;

GRANT REFERENCES ON TABLE public.friend_requests TO authenticated;

GRANT SELECT ON TABLE public.friend_requests TO authenticated;

GRANT TRIGGER ON TABLE public.friend_requests TO authenticated;

GRANT TRUNCATE ON TABLE public.friend_requests TO authenticated;

GRANT UPDATE ON TABLE public.friend_requests TO authenticated;

GRANT DELETE ON TABLE public.friend_requests TO service_role;

GRANT INSERT ON TABLE public.friend_requests TO service_role;

GRANT MAINTAIN ON TABLE public.friend_requests TO service_role;

GRANT REFERENCES ON TABLE public.friend_requests TO service_role;

GRANT SELECT ON TABLE public.friend_requests TO service_role;

GRANT TRIGGER ON TABLE public.friend_requests TO service_role;

GRANT TRUNCATE ON TABLE public.friend_requests TO service_role;

GRANT UPDATE ON TABLE public.friend_requests TO service_role;

GRANT DELETE ON TABLE public.item_chats TO postgres;

GRANT INSERT ON TABLE public.item_chats TO postgres;

GRANT MAINTAIN ON TABLE public.item_chats TO postgres;

GRANT REFERENCES ON TABLE public.item_chats TO postgres;

GRANT SELECT ON TABLE public.item_chats TO postgres;

GRANT TRIGGER ON TABLE public.item_chats TO postgres;

GRANT TRUNCATE ON TABLE public.item_chats TO postgres;

GRANT UPDATE ON TABLE public.item_chats TO postgres;

GRANT DELETE ON TABLE public.item_chats TO anon;

GRANT INSERT ON TABLE public.item_chats TO anon;

GRANT MAINTAIN ON TABLE public.item_chats TO anon;

GRANT REFERENCES ON TABLE public.item_chats TO anon;

GRANT SELECT ON TABLE public.item_chats TO anon;

GRANT TRIGGER ON TABLE public.item_chats TO anon;

GRANT TRUNCATE ON TABLE public.item_chats TO anon;

GRANT UPDATE ON TABLE public.item_chats TO anon;

GRANT DELETE ON TABLE public.item_chats TO authenticated;

GRANT INSERT ON TABLE public.item_chats TO authenticated;

GRANT MAINTAIN ON TABLE public.item_chats TO authenticated;

GRANT REFERENCES ON TABLE public.item_chats TO authenticated;

GRANT SELECT ON TABLE public.item_chats TO authenticated;

GRANT TRIGGER ON TABLE public.item_chats TO authenticated;

GRANT TRUNCATE ON TABLE public.item_chats TO authenticated;

GRANT UPDATE ON TABLE public.item_chats TO authenticated;

GRANT DELETE ON TABLE public.item_chats TO service_role;

GRANT INSERT ON TABLE public.item_chats TO service_role;

GRANT MAINTAIN ON TABLE public.item_chats TO service_role;

GRANT REFERENCES ON TABLE public.item_chats TO service_role;

GRANT SELECT ON TABLE public.item_chats TO service_role;

GRANT TRIGGER ON TABLE public.item_chats TO service_role;

GRANT TRUNCATE ON TABLE public.item_chats TO service_role;

GRANT UPDATE ON TABLE public.item_chats TO service_role;

GRANT DELETE ON TABLE public.lga_wards TO postgres;

GRANT INSERT ON TABLE public.lga_wards TO postgres;

GRANT MAINTAIN ON TABLE public.lga_wards TO postgres;

GRANT REFERENCES ON TABLE public.lga_wards TO postgres;

GRANT SELECT ON TABLE public.lga_wards TO postgres;

GRANT TRIGGER ON TABLE public.lga_wards TO postgres;

GRANT TRUNCATE ON TABLE public.lga_wards TO postgres;

GRANT UPDATE ON TABLE public.lga_wards TO postgres;

GRANT DELETE ON TABLE public.lga_wards TO anon;

GRANT INSERT ON TABLE public.lga_wards TO anon;

GRANT MAINTAIN ON TABLE public.lga_wards TO anon;

GRANT REFERENCES ON TABLE public.lga_wards TO anon;

GRANT SELECT ON TABLE public.lga_wards TO anon;

GRANT TRIGGER ON TABLE public.lga_wards TO anon;

GRANT TRUNCATE ON TABLE public.lga_wards TO anon;

GRANT UPDATE ON TABLE public.lga_wards TO anon;

GRANT DELETE ON TABLE public.lga_wards TO authenticated;

GRANT INSERT ON TABLE public.lga_wards TO authenticated;

GRANT MAINTAIN ON TABLE public.lga_wards TO authenticated;

GRANT REFERENCES ON TABLE public.lga_wards TO authenticated;

GRANT SELECT ON TABLE public.lga_wards TO authenticated;

GRANT TRIGGER ON TABLE public.lga_wards TO authenticated;

GRANT TRUNCATE ON TABLE public.lga_wards TO authenticated;

GRANT UPDATE ON TABLE public.lga_wards TO authenticated;

GRANT DELETE ON TABLE public.lga_wards TO service_role;

GRANT INSERT ON TABLE public.lga_wards TO service_role;

GRANT MAINTAIN ON TABLE public.lga_wards TO service_role;

GRANT REFERENCES ON TABLE public.lga_wards TO service_role;

GRANT SELECT ON TABLE public.lga_wards TO service_role;

GRANT TRIGGER ON TABLE public.lga_wards TO service_role;

GRANT TRUNCATE ON TABLE public.lga_wards TO service_role;

GRANT UPDATE ON TABLE public.lga_wards TO service_role;

GRANT DELETE ON TABLE public.marketing_rate_limits TO postgres;

GRANT INSERT ON TABLE public.marketing_rate_limits TO postgres;

GRANT MAINTAIN ON TABLE public.marketing_rate_limits TO postgres;

GRANT REFERENCES ON TABLE public.marketing_rate_limits TO postgres;

GRANT SELECT ON TABLE public.marketing_rate_limits TO postgres;

GRANT TRIGGER ON TABLE public.marketing_rate_limits TO postgres;

GRANT TRUNCATE ON TABLE public.marketing_rate_limits TO postgres;

GRANT UPDATE ON TABLE public.marketing_rate_limits TO postgres;

GRANT DELETE ON TABLE public.marketing_rate_limits TO anon;

GRANT INSERT ON TABLE public.marketing_rate_limits TO anon;

GRANT MAINTAIN ON TABLE public.marketing_rate_limits TO anon;

GRANT REFERENCES ON TABLE public.marketing_rate_limits TO anon;

GRANT SELECT ON TABLE public.marketing_rate_limits TO anon;

GRANT TRIGGER ON TABLE public.marketing_rate_limits TO anon;

GRANT TRUNCATE ON TABLE public.marketing_rate_limits TO anon;

GRANT UPDATE ON TABLE public.marketing_rate_limits TO anon;

GRANT DELETE ON TABLE public.marketing_rate_limits TO authenticated;

GRANT INSERT ON TABLE public.marketing_rate_limits TO authenticated;

GRANT MAINTAIN ON TABLE public.marketing_rate_limits TO authenticated;

GRANT REFERENCES ON TABLE public.marketing_rate_limits TO authenticated;

GRANT SELECT ON TABLE public.marketing_rate_limits TO authenticated;

GRANT TRIGGER ON TABLE public.marketing_rate_limits TO authenticated;

GRANT TRUNCATE ON TABLE public.marketing_rate_limits TO authenticated;

GRANT UPDATE ON TABLE public.marketing_rate_limits TO authenticated;

GRANT DELETE ON TABLE public.marketing_rate_limits TO service_role;

GRANT INSERT ON TABLE public.marketing_rate_limits TO service_role;

GRANT MAINTAIN ON TABLE public.marketing_rate_limits TO service_role;

GRANT REFERENCES ON TABLE public.marketing_rate_limits TO service_role;

GRANT SELECT ON TABLE public.marketing_rate_limits TO service_role;

GRANT TRIGGER ON TABLE public.marketing_rate_limits TO service_role;

GRANT TRUNCATE ON TABLE public.marketing_rate_limits TO service_role;

GRANT UPDATE ON TABLE public.marketing_rate_limits TO service_role;

GRANT DELETE ON TABLE public.messages TO postgres;

GRANT INSERT ON TABLE public.messages TO postgres;

GRANT MAINTAIN ON TABLE public.messages TO postgres;

GRANT REFERENCES ON TABLE public.messages TO postgres;

GRANT SELECT ON TABLE public.messages TO postgres;

GRANT TRIGGER ON TABLE public.messages TO postgres;

GRANT TRUNCATE ON TABLE public.messages TO postgres;

GRANT UPDATE ON TABLE public.messages TO postgres;

GRANT DELETE ON TABLE public.messages TO anon;

GRANT INSERT ON TABLE public.messages TO anon;

GRANT MAINTAIN ON TABLE public.messages TO anon;

GRANT REFERENCES ON TABLE public.messages TO anon;

GRANT SELECT ON TABLE public.messages TO anon;

GRANT TRIGGER ON TABLE public.messages TO anon;

GRANT TRUNCATE ON TABLE public.messages TO anon;

GRANT UPDATE ON TABLE public.messages TO anon;

GRANT DELETE ON TABLE public.messages TO authenticated;

GRANT INSERT ON TABLE public.messages TO authenticated;

GRANT MAINTAIN ON TABLE public.messages TO authenticated;

GRANT REFERENCES ON TABLE public.messages TO authenticated;

GRANT SELECT ON TABLE public.messages TO authenticated;

GRANT TRIGGER ON TABLE public.messages TO authenticated;

GRANT TRUNCATE ON TABLE public.messages TO authenticated;

GRANT UPDATE ON TABLE public.messages TO authenticated;

GRANT DELETE ON TABLE public.messages TO service_role;

GRANT INSERT ON TABLE public.messages TO service_role;

GRANT MAINTAIN ON TABLE public.messages TO service_role;

GRANT REFERENCES ON TABLE public.messages TO service_role;

GRANT SELECT ON TABLE public.messages TO service_role;

GRANT TRIGGER ON TABLE public.messages TO service_role;

GRANT TRUNCATE ON TABLE public.messages TO service_role;

GRANT UPDATE ON TABLE public.messages TO service_role;

GRANT DELETE ON TABLE public.moderation_queue TO postgres;

GRANT INSERT ON TABLE public.moderation_queue TO postgres;

GRANT MAINTAIN ON TABLE public.moderation_queue TO postgres;

GRANT REFERENCES ON TABLE public.moderation_queue TO postgres;

GRANT SELECT ON TABLE public.moderation_queue TO postgres;

GRANT TRIGGER ON TABLE public.moderation_queue TO postgres;

GRANT TRUNCATE ON TABLE public.moderation_queue TO postgres;

GRANT UPDATE ON TABLE public.moderation_queue TO postgres;

GRANT DELETE ON TABLE public.moderation_queue TO anon;

GRANT INSERT ON TABLE public.moderation_queue TO anon;

GRANT MAINTAIN ON TABLE public.moderation_queue TO anon;

GRANT REFERENCES ON TABLE public.moderation_queue TO anon;

GRANT SELECT ON TABLE public.moderation_queue TO anon;

GRANT TRIGGER ON TABLE public.moderation_queue TO anon;

GRANT TRUNCATE ON TABLE public.moderation_queue TO anon;

GRANT UPDATE ON TABLE public.moderation_queue TO anon;

GRANT DELETE ON TABLE public.moderation_queue TO authenticated;

GRANT INSERT ON TABLE public.moderation_queue TO authenticated;

GRANT MAINTAIN ON TABLE public.moderation_queue TO authenticated;

GRANT REFERENCES ON TABLE public.moderation_queue TO authenticated;

GRANT SELECT ON TABLE public.moderation_queue TO authenticated;

GRANT TRIGGER ON TABLE public.moderation_queue TO authenticated;

GRANT TRUNCATE ON TABLE public.moderation_queue TO authenticated;

GRANT UPDATE ON TABLE public.moderation_queue TO authenticated;

GRANT DELETE ON TABLE public.moderation_queue TO service_role;

GRANT INSERT ON TABLE public.moderation_queue TO service_role;

GRANT MAINTAIN ON TABLE public.moderation_queue TO service_role;

GRANT REFERENCES ON TABLE public.moderation_queue TO service_role;

GRANT SELECT ON TABLE public.moderation_queue TO service_role;

GRANT TRIGGER ON TABLE public.moderation_queue TO service_role;

GRANT TRUNCATE ON TABLE public.moderation_queue TO service_role;

GRANT UPDATE ON TABLE public.moderation_queue TO service_role;

GRANT DELETE ON TABLE public.my_tickets TO postgres;

GRANT INSERT ON TABLE public.my_tickets TO postgres;

GRANT MAINTAIN ON TABLE public.my_tickets TO postgres;

GRANT REFERENCES ON TABLE public.my_tickets TO postgres;

GRANT SELECT ON TABLE public.my_tickets TO postgres;

GRANT TRIGGER ON TABLE public.my_tickets TO postgres;

GRANT TRUNCATE ON TABLE public.my_tickets TO postgres;

GRANT UPDATE ON TABLE public.my_tickets TO postgres;

GRANT DELETE ON TABLE public.my_tickets TO anon;

GRANT INSERT ON TABLE public.my_tickets TO anon;

GRANT MAINTAIN ON TABLE public.my_tickets TO anon;

GRANT REFERENCES ON TABLE public.my_tickets TO anon;

GRANT SELECT ON TABLE public.my_tickets TO anon;

GRANT TRIGGER ON TABLE public.my_tickets TO anon;

GRANT TRUNCATE ON TABLE public.my_tickets TO anon;

GRANT UPDATE ON TABLE public.my_tickets TO anon;

GRANT DELETE ON TABLE public.my_tickets TO authenticated;

GRANT INSERT ON TABLE public.my_tickets TO authenticated;

GRANT MAINTAIN ON TABLE public.my_tickets TO authenticated;

GRANT REFERENCES ON TABLE public.my_tickets TO authenticated;

GRANT SELECT ON TABLE public.my_tickets TO authenticated;

GRANT TRIGGER ON TABLE public.my_tickets TO authenticated;

GRANT TRUNCATE ON TABLE public.my_tickets TO authenticated;

GRANT UPDATE ON TABLE public.my_tickets TO authenticated;

GRANT DELETE ON TABLE public.my_tickets TO service_role;

GRANT INSERT ON TABLE public.my_tickets TO service_role;

GRANT MAINTAIN ON TABLE public.my_tickets TO service_role;

GRANT REFERENCES ON TABLE public.my_tickets TO service_role;

GRANT SELECT ON TABLE public.my_tickets TO service_role;

GRANT TRIGGER ON TABLE public.my_tickets TO service_role;

GRANT TRUNCATE ON TABLE public.my_tickets TO service_role;

GRANT UPDATE ON TABLE public.my_tickets TO service_role;

GRANT DELETE ON TABLE public.notification_stats TO postgres;

GRANT INSERT ON TABLE public.notification_stats TO postgres;

GRANT MAINTAIN ON TABLE public.notification_stats TO postgres;

GRANT REFERENCES ON TABLE public.notification_stats TO postgres;

GRANT SELECT ON TABLE public.notification_stats TO postgres;

GRANT TRIGGER ON TABLE public.notification_stats TO postgres;

GRANT TRUNCATE ON TABLE public.notification_stats TO postgres;

GRANT UPDATE ON TABLE public.notification_stats TO postgres;

GRANT DELETE ON TABLE public.notification_stats TO anon;

GRANT INSERT ON TABLE public.notification_stats TO anon;

GRANT MAINTAIN ON TABLE public.notification_stats TO anon;

GRANT REFERENCES ON TABLE public.notification_stats TO anon;

GRANT SELECT ON TABLE public.notification_stats TO anon;

GRANT TRIGGER ON TABLE public.notification_stats TO anon;

GRANT TRUNCATE ON TABLE public.notification_stats TO anon;

GRANT UPDATE ON TABLE public.notification_stats TO anon;

GRANT DELETE ON TABLE public.notification_stats TO authenticated;

GRANT INSERT ON TABLE public.notification_stats TO authenticated;

GRANT MAINTAIN ON TABLE public.notification_stats TO authenticated;

GRANT REFERENCES ON TABLE public.notification_stats TO authenticated;

GRANT SELECT ON TABLE public.notification_stats TO authenticated;

GRANT TRIGGER ON TABLE public.notification_stats TO authenticated;

GRANT TRUNCATE ON TABLE public.notification_stats TO authenticated;

GRANT UPDATE ON TABLE public.notification_stats TO authenticated;

GRANT DELETE ON TABLE public.notification_stats TO service_role;

GRANT INSERT ON TABLE public.notification_stats TO service_role;

GRANT MAINTAIN ON TABLE public.notification_stats TO service_role;

GRANT REFERENCES ON TABLE public.notification_stats TO service_role;

GRANT SELECT ON TABLE public.notification_stats TO service_role;

GRANT TRIGGER ON TABLE public.notification_stats TO service_role;

GRANT TRUNCATE ON TABLE public.notification_stats TO service_role;

GRANT UPDATE ON TABLE public.notification_stats TO service_role;

GRANT DELETE ON TABLE public.notifications TO postgres;

GRANT INSERT ON TABLE public.notifications TO postgres;

GRANT MAINTAIN ON TABLE public.notifications TO postgres;

GRANT REFERENCES ON TABLE public.notifications TO postgres;

GRANT SELECT ON TABLE public.notifications TO postgres;

GRANT TRIGGER ON TABLE public.notifications TO postgres;

GRANT TRUNCATE ON TABLE public.notifications TO postgres;

GRANT UPDATE ON TABLE public.notifications TO postgres;

GRANT DELETE ON TABLE public.notifications TO anon;

GRANT INSERT ON TABLE public.notifications TO anon;

GRANT MAINTAIN ON TABLE public.notifications TO anon;

GRANT REFERENCES ON TABLE public.notifications TO anon;

GRANT SELECT ON TABLE public.notifications TO anon;

GRANT TRIGGER ON TABLE public.notifications TO anon;

GRANT TRUNCATE ON TABLE public.notifications TO anon;

GRANT UPDATE ON TABLE public.notifications TO anon;

GRANT DELETE ON TABLE public.notifications TO authenticated;

GRANT INSERT ON TABLE public.notifications TO authenticated;

GRANT MAINTAIN ON TABLE public.notifications TO authenticated;

GRANT REFERENCES ON TABLE public.notifications TO authenticated;

GRANT SELECT ON TABLE public.notifications TO authenticated;

GRANT TRIGGER ON TABLE public.notifications TO authenticated;

GRANT TRUNCATE ON TABLE public.notifications TO authenticated;

GRANT UPDATE ON TABLE public.notifications TO authenticated;

GRANT DELETE ON TABLE public.notifications TO service_role;

GRANT INSERT ON TABLE public.notifications TO service_role;

GRANT MAINTAIN ON TABLE public.notifications TO service_role;

GRANT REFERENCES ON TABLE public.notifications TO service_role;

GRANT SELECT ON TABLE public.notifications TO service_role;

GRANT TRIGGER ON TABLE public.notifications TO service_role;

GRANT TRUNCATE ON TABLE public.notifications TO service_role;

GRANT UPDATE ON TABLE public.notifications TO service_role;

GRANT DELETE ON TABLE public.payment_reconciliation_flags TO postgres;

GRANT INSERT ON TABLE public.payment_reconciliation_flags TO postgres;

GRANT MAINTAIN ON TABLE public.payment_reconciliation_flags TO postgres;

GRANT REFERENCES ON TABLE public.payment_reconciliation_flags TO postgres;

GRANT SELECT ON TABLE public.payment_reconciliation_flags TO postgres;

GRANT TRIGGER ON TABLE public.payment_reconciliation_flags TO postgres;

GRANT TRUNCATE ON TABLE public.payment_reconciliation_flags TO postgres;

GRANT UPDATE ON TABLE public.payment_reconciliation_flags TO postgres;

GRANT DELETE ON TABLE public.payment_reconciliation_flags TO service_role;

GRANT INSERT ON TABLE public.payment_reconciliation_flags TO service_role;

GRANT MAINTAIN ON TABLE public.payment_reconciliation_flags TO service_role;

GRANT REFERENCES ON TABLE public.payment_reconciliation_flags TO service_role;

GRANT SELECT ON TABLE public.payment_reconciliation_flags TO service_role;

GRANT TRIGGER ON TABLE public.payment_reconciliation_flags TO service_role;

GRANT TRUNCATE ON TABLE public.payment_reconciliation_flags TO service_role;

GRANT UPDATE ON TABLE public.payment_reconciliation_flags TO service_role;

GRANT DELETE ON TABLE public.payout_requests TO postgres;

GRANT INSERT ON TABLE public.payout_requests TO postgres;

GRANT MAINTAIN ON TABLE public.payout_requests TO postgres;

GRANT REFERENCES ON TABLE public.payout_requests TO postgres;

GRANT SELECT ON TABLE public.payout_requests TO postgres;

GRANT TRIGGER ON TABLE public.payout_requests TO postgres;

GRANT TRUNCATE ON TABLE public.payout_requests TO postgres;

GRANT UPDATE ON TABLE public.payout_requests TO postgres;

GRANT DELETE ON TABLE public.payout_requests TO anon;

GRANT INSERT ON TABLE public.payout_requests TO anon;

GRANT MAINTAIN ON TABLE public.payout_requests TO anon;

GRANT REFERENCES ON TABLE public.payout_requests TO anon;

GRANT SELECT ON TABLE public.payout_requests TO anon;

GRANT TRIGGER ON TABLE public.payout_requests TO anon;

GRANT TRUNCATE ON TABLE public.payout_requests TO anon;

GRANT UPDATE ON TABLE public.payout_requests TO anon;

GRANT DELETE ON TABLE public.payout_requests TO authenticated;

GRANT INSERT ON TABLE public.payout_requests TO authenticated;

GRANT MAINTAIN ON TABLE public.payout_requests TO authenticated;

GRANT REFERENCES ON TABLE public.payout_requests TO authenticated;

GRANT SELECT ON TABLE public.payout_requests TO authenticated;

GRANT TRIGGER ON TABLE public.payout_requests TO authenticated;

GRANT TRUNCATE ON TABLE public.payout_requests TO authenticated;

GRANT UPDATE ON TABLE public.payout_requests TO authenticated;

GRANT DELETE ON TABLE public.payout_requests TO service_role;

GRANT INSERT ON TABLE public.payout_requests TO service_role;

GRANT MAINTAIN ON TABLE public.payout_requests TO service_role;

GRANT REFERENCES ON TABLE public.payout_requests TO service_role;

GRANT SELECT ON TABLE public.payout_requests TO service_role;

GRANT TRIGGER ON TABLE public.payout_requests TO service_role;

GRANT TRUNCATE ON TABLE public.payout_requests TO service_role;

GRANT UPDATE ON TABLE public.payout_requests TO service_role;

GRANT DELETE ON TABLE public.post_bookmarks TO postgres;

GRANT INSERT ON TABLE public.post_bookmarks TO postgres;

GRANT MAINTAIN ON TABLE public.post_bookmarks TO postgres;

GRANT REFERENCES ON TABLE public.post_bookmarks TO postgres;

GRANT SELECT ON TABLE public.post_bookmarks TO postgres;

GRANT TRIGGER ON TABLE public.post_bookmarks TO postgres;

GRANT TRUNCATE ON TABLE public.post_bookmarks TO postgres;

GRANT UPDATE ON TABLE public.post_bookmarks TO postgres;

GRANT DELETE ON TABLE public.post_bookmarks TO anon;

GRANT INSERT ON TABLE public.post_bookmarks TO anon;

GRANT MAINTAIN ON TABLE public.post_bookmarks TO anon;

GRANT REFERENCES ON TABLE public.post_bookmarks TO anon;

GRANT SELECT ON TABLE public.post_bookmarks TO anon;

GRANT TRIGGER ON TABLE public.post_bookmarks TO anon;

GRANT TRUNCATE ON TABLE public.post_bookmarks TO anon;

GRANT UPDATE ON TABLE public.post_bookmarks TO anon;

GRANT DELETE ON TABLE public.post_bookmarks TO authenticated;

GRANT INSERT ON TABLE public.post_bookmarks TO authenticated;

GRANT MAINTAIN ON TABLE public.post_bookmarks TO authenticated;

GRANT REFERENCES ON TABLE public.post_bookmarks TO authenticated;

GRANT SELECT ON TABLE public.post_bookmarks TO authenticated;

GRANT TRIGGER ON TABLE public.post_bookmarks TO authenticated;

GRANT TRUNCATE ON TABLE public.post_bookmarks TO authenticated;

GRANT UPDATE ON TABLE public.post_bookmarks TO authenticated;

GRANT DELETE ON TABLE public.post_bookmarks TO service_role;

GRANT INSERT ON TABLE public.post_bookmarks TO service_role;

GRANT MAINTAIN ON TABLE public.post_bookmarks TO service_role;

GRANT REFERENCES ON TABLE public.post_bookmarks TO service_role;

GRANT SELECT ON TABLE public.post_bookmarks TO service_role;

GRANT TRIGGER ON TABLE public.post_bookmarks TO service_role;

GRANT TRUNCATE ON TABLE public.post_bookmarks TO service_role;

GRANT UPDATE ON TABLE public.post_bookmarks TO service_role;

GRANT DELETE ON TABLE public.post_reports TO postgres;

GRANT INSERT ON TABLE public.post_reports TO postgres;

GRANT MAINTAIN ON TABLE public.post_reports TO postgres;

GRANT REFERENCES ON TABLE public.post_reports TO postgres;

GRANT SELECT ON TABLE public.post_reports TO postgres;

GRANT TRIGGER ON TABLE public.post_reports TO postgres;

GRANT TRUNCATE ON TABLE public.post_reports TO postgres;

GRANT UPDATE ON TABLE public.post_reports TO postgres;

GRANT DELETE ON TABLE public.post_reports TO anon;

GRANT INSERT ON TABLE public.post_reports TO anon;

GRANT MAINTAIN ON TABLE public.post_reports TO anon;

GRANT REFERENCES ON TABLE public.post_reports TO anon;

GRANT SELECT ON TABLE public.post_reports TO anon;

GRANT TRIGGER ON TABLE public.post_reports TO anon;

GRANT TRUNCATE ON TABLE public.post_reports TO anon;

GRANT UPDATE ON TABLE public.post_reports TO anon;

GRANT DELETE ON TABLE public.post_reports TO authenticated;

GRANT INSERT ON TABLE public.post_reports TO authenticated;

GRANT MAINTAIN ON TABLE public.post_reports TO authenticated;

GRANT REFERENCES ON TABLE public.post_reports TO authenticated;

GRANT SELECT ON TABLE public.post_reports TO authenticated;

GRANT TRIGGER ON TABLE public.post_reports TO authenticated;

GRANT TRUNCATE ON TABLE public.post_reports TO authenticated;

GRANT UPDATE ON TABLE public.post_reports TO authenticated;

GRANT DELETE ON TABLE public.post_reports TO service_role;

GRANT INSERT ON TABLE public.post_reports TO service_role;

GRANT MAINTAIN ON TABLE public.post_reports TO service_role;

GRANT REFERENCES ON TABLE public.post_reports TO service_role;

GRANT SELECT ON TABLE public.post_reports TO service_role;

GRANT TRIGGER ON TABLE public.post_reports TO service_role;

GRANT TRUNCATE ON TABLE public.post_reports TO service_role;

GRANT UPDATE ON TABLE public.post_reports TO service_role;

GRANT DELETE ON TABLE public.posts TO postgres;

GRANT INSERT ON TABLE public.posts TO postgres;

GRANT MAINTAIN ON TABLE public.posts TO postgres;

GRANT REFERENCES ON TABLE public.posts TO postgres;

GRANT SELECT ON TABLE public.posts TO postgres;

GRANT TRIGGER ON TABLE public.posts TO postgres;

GRANT TRUNCATE ON TABLE public.posts TO postgres;

GRANT UPDATE ON TABLE public.posts TO postgres;

GRANT DELETE ON TABLE public.posts TO anon;

GRANT INSERT ON TABLE public.posts TO anon;

GRANT MAINTAIN ON TABLE public.posts TO anon;

GRANT REFERENCES ON TABLE public.posts TO anon;

GRANT SELECT ON TABLE public.posts TO anon;

GRANT TRIGGER ON TABLE public.posts TO anon;

GRANT TRUNCATE ON TABLE public.posts TO anon;

GRANT UPDATE ON TABLE public.posts TO anon;

GRANT DELETE ON TABLE public.posts TO authenticated;

GRANT INSERT ON TABLE public.posts TO authenticated;

GRANT MAINTAIN ON TABLE public.posts TO authenticated;

GRANT REFERENCES ON TABLE public.posts TO authenticated;

GRANT SELECT ON TABLE public.posts TO authenticated;

GRANT TRIGGER ON TABLE public.posts TO authenticated;

GRANT TRUNCATE ON TABLE public.posts TO authenticated;

GRANT UPDATE ON TABLE public.posts TO authenticated;

GRANT DELETE ON TABLE public.posts TO service_role;

GRANT INSERT ON TABLE public.posts TO service_role;

GRANT MAINTAIN ON TABLE public.posts TO service_role;

GRANT REFERENCES ON TABLE public.posts TO service_role;

GRANT SELECT ON TABLE public.posts TO service_role;

GRANT TRIGGER ON TABLE public.posts TO service_role;

GRANT TRUNCATE ON TABLE public.posts TO service_role;

GRANT UPDATE ON TABLE public.posts TO service_role;

GRANT DELETE ON TABLE public.provider_availability TO postgres;

GRANT INSERT ON TABLE public.provider_availability TO postgres;

GRANT MAINTAIN ON TABLE public.provider_availability TO postgres;

GRANT REFERENCES ON TABLE public.provider_availability TO postgres;

GRANT SELECT ON TABLE public.provider_availability TO postgres;

GRANT TRIGGER ON TABLE public.provider_availability TO postgres;

GRANT TRUNCATE ON TABLE public.provider_availability TO postgres;

GRANT UPDATE ON TABLE public.provider_availability TO postgres;

GRANT DELETE ON TABLE public.provider_availability TO anon;

GRANT INSERT ON TABLE public.provider_availability TO anon;

GRANT MAINTAIN ON TABLE public.provider_availability TO anon;

GRANT REFERENCES ON TABLE public.provider_availability TO anon;

GRANT SELECT ON TABLE public.provider_availability TO anon;

GRANT TRIGGER ON TABLE public.provider_availability TO anon;

GRANT TRUNCATE ON TABLE public.provider_availability TO anon;

GRANT UPDATE ON TABLE public.provider_availability TO anon;

GRANT DELETE ON TABLE public.provider_availability TO authenticated;

GRANT INSERT ON TABLE public.provider_availability TO authenticated;

GRANT MAINTAIN ON TABLE public.provider_availability TO authenticated;

GRANT REFERENCES ON TABLE public.provider_availability TO authenticated;

GRANT SELECT ON TABLE public.provider_availability TO authenticated;

GRANT TRIGGER ON TABLE public.provider_availability TO authenticated;

GRANT TRUNCATE ON TABLE public.provider_availability TO authenticated;

GRANT UPDATE ON TABLE public.provider_availability TO authenticated;

GRANT DELETE ON TABLE public.provider_availability TO service_role;

GRANT INSERT ON TABLE public.provider_availability TO service_role;

GRANT MAINTAIN ON TABLE public.provider_availability TO service_role;

GRANT REFERENCES ON TABLE public.provider_availability TO service_role;

GRANT SELECT ON TABLE public.provider_availability TO service_role;

GRANT TRIGGER ON TABLE public.provider_availability TO service_role;

GRANT TRUNCATE ON TABLE public.provider_availability TO service_role;

GRANT UPDATE ON TABLE public.provider_availability TO service_role;

GRANT DELETE ON TABLE public.public_profiles TO postgres;

GRANT INSERT ON TABLE public.public_profiles TO postgres;

GRANT MAINTAIN ON TABLE public.public_profiles TO postgres;

GRANT REFERENCES ON TABLE public.public_profiles TO postgres;

GRANT SELECT ON TABLE public.public_profiles TO postgres;

GRANT TRIGGER ON TABLE public.public_profiles TO postgres;

GRANT TRUNCATE ON TABLE public.public_profiles TO postgres;

GRANT UPDATE ON TABLE public.public_profiles TO postgres;

GRANT SELECT ON TABLE public.public_profiles TO anon;

GRANT SELECT ON TABLE public.public_profiles TO authenticated;

GRANT DELETE ON TABLE public.public_profiles TO service_role;

GRANT INSERT ON TABLE public.public_profiles TO service_role;

GRANT MAINTAIN ON TABLE public.public_profiles TO service_role;

GRANT REFERENCES ON TABLE public.public_profiles TO service_role;

GRANT SELECT ON TABLE public.public_profiles TO service_role;

GRANT TRIGGER ON TABLE public.public_profiles TO service_role;

GRANT TRUNCATE ON TABLE public.public_profiles TO service_role;

GRANT UPDATE ON TABLE public.public_profiles TO service_role;

GRANT DELETE ON TABLE public.push_subscriptions TO postgres;

GRANT INSERT ON TABLE public.push_subscriptions TO postgres;

GRANT MAINTAIN ON TABLE public.push_subscriptions TO postgres;

GRANT REFERENCES ON TABLE public.push_subscriptions TO postgres;

GRANT SELECT ON TABLE public.push_subscriptions TO postgres;

GRANT TRIGGER ON TABLE public.push_subscriptions TO postgres;

GRANT TRUNCATE ON TABLE public.push_subscriptions TO postgres;

GRANT UPDATE ON TABLE public.push_subscriptions TO postgres;

GRANT DELETE ON TABLE public.push_subscriptions TO anon;

GRANT INSERT ON TABLE public.push_subscriptions TO anon;

GRANT MAINTAIN ON TABLE public.push_subscriptions TO anon;

GRANT REFERENCES ON TABLE public.push_subscriptions TO anon;

GRANT SELECT ON TABLE public.push_subscriptions TO anon;

GRANT TRIGGER ON TABLE public.push_subscriptions TO anon;

GRANT TRUNCATE ON TABLE public.push_subscriptions TO anon;

GRANT UPDATE ON TABLE public.push_subscriptions TO anon;

GRANT DELETE ON TABLE public.push_subscriptions TO authenticated;

GRANT INSERT ON TABLE public.push_subscriptions TO authenticated;

GRANT MAINTAIN ON TABLE public.push_subscriptions TO authenticated;

GRANT REFERENCES ON TABLE public.push_subscriptions TO authenticated;

GRANT SELECT ON TABLE public.push_subscriptions TO authenticated;

GRANT TRIGGER ON TABLE public.push_subscriptions TO authenticated;

GRANT TRUNCATE ON TABLE public.push_subscriptions TO authenticated;

GRANT UPDATE ON TABLE public.push_subscriptions TO authenticated;

GRANT DELETE ON TABLE public.push_subscriptions TO service_role;

GRANT INSERT ON TABLE public.push_subscriptions TO service_role;

GRANT MAINTAIN ON TABLE public.push_subscriptions TO service_role;

GRANT REFERENCES ON TABLE public.push_subscriptions TO service_role;

GRANT SELECT ON TABLE public.push_subscriptions TO service_role;

GRANT TRIGGER ON TABLE public.push_subscriptions TO service_role;

GRANT TRUNCATE ON TABLE public.push_subscriptions TO service_role;

GRANT UPDATE ON TABLE public.push_subscriptions TO service_role;

GRANT DELETE ON TABLE public.quote_messages TO postgres;

GRANT INSERT ON TABLE public.quote_messages TO postgres;

GRANT MAINTAIN ON TABLE public.quote_messages TO postgres;

GRANT REFERENCES ON TABLE public.quote_messages TO postgres;

GRANT SELECT ON TABLE public.quote_messages TO postgres;

GRANT TRIGGER ON TABLE public.quote_messages TO postgres;

GRANT TRUNCATE ON TABLE public.quote_messages TO postgres;

GRANT UPDATE ON TABLE public.quote_messages TO postgres;

GRANT DELETE ON TABLE public.quote_messages TO anon;

GRANT INSERT ON TABLE public.quote_messages TO anon;

GRANT MAINTAIN ON TABLE public.quote_messages TO anon;

GRANT REFERENCES ON TABLE public.quote_messages TO anon;

GRANT SELECT ON TABLE public.quote_messages TO anon;

GRANT TRIGGER ON TABLE public.quote_messages TO anon;

GRANT TRUNCATE ON TABLE public.quote_messages TO anon;

GRANT UPDATE ON TABLE public.quote_messages TO anon;

GRANT DELETE ON TABLE public.quote_messages TO authenticated;

GRANT INSERT ON TABLE public.quote_messages TO authenticated;

GRANT MAINTAIN ON TABLE public.quote_messages TO authenticated;

GRANT REFERENCES ON TABLE public.quote_messages TO authenticated;

GRANT SELECT ON TABLE public.quote_messages TO authenticated;

GRANT TRIGGER ON TABLE public.quote_messages TO authenticated;

GRANT TRUNCATE ON TABLE public.quote_messages TO authenticated;

GRANT UPDATE ON TABLE public.quote_messages TO authenticated;

GRANT DELETE ON TABLE public.quote_messages TO service_role;

GRANT INSERT ON TABLE public.quote_messages TO service_role;

GRANT MAINTAIN ON TABLE public.quote_messages TO service_role;

GRANT REFERENCES ON TABLE public.quote_messages TO service_role;

GRANT SELECT ON TABLE public.quote_messages TO service_role;

GRANT TRIGGER ON TABLE public.quote_messages TO service_role;

GRANT TRUNCATE ON TABLE public.quote_messages TO service_role;

GRANT UPDATE ON TABLE public.quote_messages TO service_role;

GRANT DELETE ON TABLE public.quote_requests TO postgres;

GRANT INSERT ON TABLE public.quote_requests TO postgres;

GRANT MAINTAIN ON TABLE public.quote_requests TO postgres;

GRANT REFERENCES ON TABLE public.quote_requests TO postgres;

GRANT SELECT ON TABLE public.quote_requests TO postgres;

GRANT TRIGGER ON TABLE public.quote_requests TO postgres;

GRANT TRUNCATE ON TABLE public.quote_requests TO postgres;

GRANT UPDATE ON TABLE public.quote_requests TO postgres;

GRANT DELETE ON TABLE public.quote_requests TO anon;

GRANT INSERT ON TABLE public.quote_requests TO anon;

GRANT MAINTAIN ON TABLE public.quote_requests TO anon;

GRANT REFERENCES ON TABLE public.quote_requests TO anon;

GRANT SELECT ON TABLE public.quote_requests TO anon;

GRANT TRIGGER ON TABLE public.quote_requests TO anon;

GRANT TRUNCATE ON TABLE public.quote_requests TO anon;

GRANT UPDATE ON TABLE public.quote_requests TO anon;

GRANT DELETE ON TABLE public.quote_requests TO authenticated;

GRANT INSERT ON TABLE public.quote_requests TO authenticated;

GRANT MAINTAIN ON TABLE public.quote_requests TO authenticated;

GRANT REFERENCES ON TABLE public.quote_requests TO authenticated;

GRANT SELECT ON TABLE public.quote_requests TO authenticated;

GRANT TRIGGER ON TABLE public.quote_requests TO authenticated;

GRANT TRUNCATE ON TABLE public.quote_requests TO authenticated;

GRANT UPDATE ON TABLE public.quote_requests TO authenticated;

GRANT DELETE ON TABLE public.quote_requests TO service_role;

GRANT INSERT ON TABLE public.quote_requests TO service_role;

GRANT MAINTAIN ON TABLE public.quote_requests TO service_role;

GRANT REFERENCES ON TABLE public.quote_requests TO service_role;

GRANT SELECT ON TABLE public.quote_requests TO service_role;

GRANT TRIGGER ON TABLE public.quote_requests TO service_role;

GRANT TRUNCATE ON TABLE public.quote_requests TO service_role;

GRANT UPDATE ON TABLE public.quote_requests TO service_role;

GRANT DELETE ON TABLE public.rate_limits TO postgres;

GRANT INSERT ON TABLE public.rate_limits TO postgres;

GRANT MAINTAIN ON TABLE public.rate_limits TO postgres;

GRANT REFERENCES ON TABLE public.rate_limits TO postgres;

GRANT SELECT ON TABLE public.rate_limits TO postgres;

GRANT TRIGGER ON TABLE public.rate_limits TO postgres;

GRANT TRUNCATE ON TABLE public.rate_limits TO postgres;

GRANT UPDATE ON TABLE public.rate_limits TO postgres;

GRANT DELETE ON TABLE public.rate_limits TO anon;

GRANT INSERT ON TABLE public.rate_limits TO anon;

GRANT MAINTAIN ON TABLE public.rate_limits TO anon;

GRANT REFERENCES ON TABLE public.rate_limits TO anon;

GRANT SELECT ON TABLE public.rate_limits TO anon;

GRANT TRIGGER ON TABLE public.rate_limits TO anon;

GRANT TRUNCATE ON TABLE public.rate_limits TO anon;

GRANT UPDATE ON TABLE public.rate_limits TO anon;

GRANT DELETE ON TABLE public.rate_limits TO authenticated;

GRANT INSERT ON TABLE public.rate_limits TO authenticated;

GRANT MAINTAIN ON TABLE public.rate_limits TO authenticated;

GRANT REFERENCES ON TABLE public.rate_limits TO authenticated;

GRANT SELECT ON TABLE public.rate_limits TO authenticated;

GRANT TRIGGER ON TABLE public.rate_limits TO authenticated;

GRANT TRUNCATE ON TABLE public.rate_limits TO authenticated;

GRANT UPDATE ON TABLE public.rate_limits TO authenticated;

GRANT DELETE ON TABLE public.rate_limits TO service_role;

GRANT INSERT ON TABLE public.rate_limits TO service_role;

GRANT MAINTAIN ON TABLE public.rate_limits TO service_role;

GRANT REFERENCES ON TABLE public.rate_limits TO service_role;

GRANT SELECT ON TABLE public.rate_limits TO service_role;

GRANT TRIGGER ON TABLE public.rate_limits TO service_role;

GRANT TRUNCATE ON TABLE public.rate_limits TO service_role;

GRANT UPDATE ON TABLE public.rate_limits TO service_role;

GRANT DELETE ON TABLE public.reports TO postgres;

GRANT INSERT ON TABLE public.reports TO postgres;

GRANT MAINTAIN ON TABLE public.reports TO postgres;

GRANT REFERENCES ON TABLE public.reports TO postgres;

GRANT SELECT ON TABLE public.reports TO postgres;

GRANT TRIGGER ON TABLE public.reports TO postgres;

GRANT TRUNCATE ON TABLE public.reports TO postgres;

GRANT UPDATE ON TABLE public.reports TO postgres;

GRANT DELETE ON TABLE public.reports TO anon;

GRANT INSERT ON TABLE public.reports TO anon;

GRANT MAINTAIN ON TABLE public.reports TO anon;

GRANT REFERENCES ON TABLE public.reports TO anon;

GRANT SELECT ON TABLE public.reports TO anon;

GRANT TRIGGER ON TABLE public.reports TO anon;

GRANT TRUNCATE ON TABLE public.reports TO anon;

GRANT UPDATE ON TABLE public.reports TO anon;

GRANT DELETE ON TABLE public.reports TO authenticated;

GRANT INSERT ON TABLE public.reports TO authenticated;

GRANT MAINTAIN ON TABLE public.reports TO authenticated;

GRANT REFERENCES ON TABLE public.reports TO authenticated;

GRANT SELECT ON TABLE public.reports TO authenticated;

GRANT TRIGGER ON TABLE public.reports TO authenticated;

GRANT TRUNCATE ON TABLE public.reports TO authenticated;

GRANT UPDATE ON TABLE public.reports TO authenticated;

GRANT DELETE ON TABLE public.reports TO service_role;

GRANT INSERT ON TABLE public.reports TO service_role;

GRANT MAINTAIN ON TABLE public.reports TO service_role;

GRANT REFERENCES ON TABLE public.reports TO service_role;

GRANT SELECT ON TABLE public.reports TO service_role;

GRANT TRIGGER ON TABLE public.reports TO service_role;

GRANT TRUNCATE ON TABLE public.reports TO service_role;

GRANT UPDATE ON TABLE public.reports TO service_role;

GRANT DELETE ON TABLE public.safety_alerts TO postgres;

GRANT INSERT ON TABLE public.safety_alerts TO postgres;

GRANT MAINTAIN ON TABLE public.safety_alerts TO postgres;

GRANT REFERENCES ON TABLE public.safety_alerts TO postgres;

GRANT SELECT ON TABLE public.safety_alerts TO postgres;

GRANT TRIGGER ON TABLE public.safety_alerts TO postgres;

GRANT TRUNCATE ON TABLE public.safety_alerts TO postgres;

GRANT UPDATE ON TABLE public.safety_alerts TO postgres;

GRANT DELETE ON TABLE public.safety_alerts TO anon;

GRANT INSERT ON TABLE public.safety_alerts TO anon;

GRANT MAINTAIN ON TABLE public.safety_alerts TO anon;

GRANT REFERENCES ON TABLE public.safety_alerts TO anon;

GRANT SELECT ON TABLE public.safety_alerts TO anon;

GRANT TRIGGER ON TABLE public.safety_alerts TO anon;

GRANT TRUNCATE ON TABLE public.safety_alerts TO anon;

GRANT UPDATE ON TABLE public.safety_alerts TO anon;

GRANT DELETE ON TABLE public.safety_alerts TO authenticated;

GRANT INSERT ON TABLE public.safety_alerts TO authenticated;

GRANT MAINTAIN ON TABLE public.safety_alerts TO authenticated;

GRANT REFERENCES ON TABLE public.safety_alerts TO authenticated;

GRANT SELECT ON TABLE public.safety_alerts TO authenticated;

GRANT TRIGGER ON TABLE public.safety_alerts TO authenticated;

GRANT TRUNCATE ON TABLE public.safety_alerts TO authenticated;

GRANT UPDATE ON TABLE public.safety_alerts TO authenticated;

GRANT DELETE ON TABLE public.safety_alerts TO service_role;

GRANT INSERT ON TABLE public.safety_alerts TO service_role;

GRANT MAINTAIN ON TABLE public.safety_alerts TO service_role;

GRANT REFERENCES ON TABLE public.safety_alerts TO service_role;

GRANT SELECT ON TABLE public.safety_alerts TO service_role;

GRANT TRIGGER ON TABLE public.safety_alerts TO service_role;

GRANT TRUNCATE ON TABLE public.safety_alerts TO service_role;

GRANT UPDATE ON TABLE public.safety_alerts TO service_role;

GRANT DELETE ON TABLE public.seller_accounts TO postgres;

GRANT INSERT ON TABLE public.seller_accounts TO postgres;

GRANT MAINTAIN ON TABLE public.seller_accounts TO postgres;

GRANT REFERENCES ON TABLE public.seller_accounts TO postgres;

GRANT SELECT ON TABLE public.seller_accounts TO postgres;

GRANT TRIGGER ON TABLE public.seller_accounts TO postgres;

GRANT TRUNCATE ON TABLE public.seller_accounts TO postgres;

GRANT UPDATE ON TABLE public.seller_accounts TO postgres;

GRANT DELETE ON TABLE public.seller_accounts TO anon;

GRANT INSERT ON TABLE public.seller_accounts TO anon;

GRANT MAINTAIN ON TABLE public.seller_accounts TO anon;

GRANT REFERENCES ON TABLE public.seller_accounts TO anon;

GRANT SELECT ON TABLE public.seller_accounts TO anon;

GRANT TRIGGER ON TABLE public.seller_accounts TO anon;

GRANT TRUNCATE ON TABLE public.seller_accounts TO anon;

GRANT UPDATE ON TABLE public.seller_accounts TO anon;

GRANT DELETE ON TABLE public.seller_accounts TO authenticated;

GRANT INSERT ON TABLE public.seller_accounts TO authenticated;

GRANT MAINTAIN ON TABLE public.seller_accounts TO authenticated;

GRANT REFERENCES ON TABLE public.seller_accounts TO authenticated;

GRANT SELECT ON TABLE public.seller_accounts TO authenticated;

GRANT TRIGGER ON TABLE public.seller_accounts TO authenticated;

GRANT TRUNCATE ON TABLE public.seller_accounts TO authenticated;

GRANT UPDATE ON TABLE public.seller_accounts TO authenticated;

GRANT DELETE ON TABLE public.seller_accounts TO service_role;

GRANT INSERT ON TABLE public.seller_accounts TO service_role;

GRANT MAINTAIN ON TABLE public.seller_accounts TO service_role;

GRANT REFERENCES ON TABLE public.seller_accounts TO service_role;

GRANT SELECT ON TABLE public.seller_accounts TO service_role;

GRANT TRIGGER ON TABLE public.seller_accounts TO service_role;

GRANT TRUNCATE ON TABLE public.seller_accounts TO service_role;

GRANT UPDATE ON TABLE public.seller_accounts TO service_role;

GRANT DELETE ON TABLE public.service_offerings TO postgres;

GRANT INSERT ON TABLE public.service_offerings TO postgres;

GRANT MAINTAIN ON TABLE public.service_offerings TO postgres;

GRANT REFERENCES ON TABLE public.service_offerings TO postgres;

GRANT SELECT ON TABLE public.service_offerings TO postgres;

GRANT TRIGGER ON TABLE public.service_offerings TO postgres;

GRANT TRUNCATE ON TABLE public.service_offerings TO postgres;

GRANT UPDATE ON TABLE public.service_offerings TO postgres;

GRANT DELETE ON TABLE public.service_offerings TO anon;

GRANT INSERT ON TABLE public.service_offerings TO anon;

GRANT MAINTAIN ON TABLE public.service_offerings TO anon;

GRANT REFERENCES ON TABLE public.service_offerings TO anon;

GRANT SELECT ON TABLE public.service_offerings TO anon;

GRANT TRIGGER ON TABLE public.service_offerings TO anon;

GRANT TRUNCATE ON TABLE public.service_offerings TO anon;

GRANT UPDATE ON TABLE public.service_offerings TO anon;

GRANT DELETE ON TABLE public.service_offerings TO authenticated;

GRANT INSERT ON TABLE public.service_offerings TO authenticated;

GRANT MAINTAIN ON TABLE public.service_offerings TO authenticated;

GRANT REFERENCES ON TABLE public.service_offerings TO authenticated;

GRANT SELECT ON TABLE public.service_offerings TO authenticated;

GRANT TRIGGER ON TABLE public.service_offerings TO authenticated;

GRANT TRUNCATE ON TABLE public.service_offerings TO authenticated;

GRANT UPDATE ON TABLE public.service_offerings TO authenticated;

GRANT DELETE ON TABLE public.service_offerings TO service_role;

GRANT INSERT ON TABLE public.service_offerings TO service_role;

GRANT MAINTAIN ON TABLE public.service_offerings TO service_role;

GRANT REFERENCES ON TABLE public.service_offerings TO service_role;

GRANT SELECT ON TABLE public.service_offerings TO service_role;

GRANT TRIGGER ON TABLE public.service_offerings TO service_role;

GRANT TRUNCATE ON TABLE public.service_offerings TO service_role;

GRANT UPDATE ON TABLE public.service_offerings TO service_role;

GRANT DELETE ON TABLE public.service_staff_assignments TO postgres;

GRANT INSERT ON TABLE public.service_staff_assignments TO postgres;

GRANT MAINTAIN ON TABLE public.service_staff_assignments TO postgres;

GRANT REFERENCES ON TABLE public.service_staff_assignments TO postgres;

GRANT SELECT ON TABLE public.service_staff_assignments TO postgres;

GRANT TRIGGER ON TABLE public.service_staff_assignments TO postgres;

GRANT TRUNCATE ON TABLE public.service_staff_assignments TO postgres;

GRANT UPDATE ON TABLE public.service_staff_assignments TO postgres;

GRANT DELETE ON TABLE public.service_staff_assignments TO anon;

GRANT INSERT ON TABLE public.service_staff_assignments TO anon;

GRANT MAINTAIN ON TABLE public.service_staff_assignments TO anon;

GRANT REFERENCES ON TABLE public.service_staff_assignments TO anon;

GRANT SELECT ON TABLE public.service_staff_assignments TO anon;

GRANT TRIGGER ON TABLE public.service_staff_assignments TO anon;

GRANT TRUNCATE ON TABLE public.service_staff_assignments TO anon;

GRANT UPDATE ON TABLE public.service_staff_assignments TO anon;

GRANT DELETE ON TABLE public.service_staff_assignments TO authenticated;

GRANT INSERT ON TABLE public.service_staff_assignments TO authenticated;

GRANT MAINTAIN ON TABLE public.service_staff_assignments TO authenticated;

GRANT REFERENCES ON TABLE public.service_staff_assignments TO authenticated;

GRANT SELECT ON TABLE public.service_staff_assignments TO authenticated;

GRANT TRIGGER ON TABLE public.service_staff_assignments TO authenticated;

GRANT TRUNCATE ON TABLE public.service_staff_assignments TO authenticated;

GRANT UPDATE ON TABLE public.service_staff_assignments TO authenticated;

GRANT DELETE ON TABLE public.service_staff_assignments TO service_role;

GRANT INSERT ON TABLE public.service_staff_assignments TO service_role;

GRANT MAINTAIN ON TABLE public.service_staff_assignments TO service_role;

GRANT REFERENCES ON TABLE public.service_staff_assignments TO service_role;

GRANT SELECT ON TABLE public.service_staff_assignments TO service_role;

GRANT TRIGGER ON TABLE public.service_staff_assignments TO service_role;

GRANT TRUNCATE ON TABLE public.service_staff_assignments TO service_role;

GRANT UPDATE ON TABLE public.service_staff_assignments TO service_role;

GRANT DELETE ON TABLE public.sms_delivery_logs TO postgres;

GRANT INSERT ON TABLE public.sms_delivery_logs TO postgres;

GRANT MAINTAIN ON TABLE public.sms_delivery_logs TO postgres;

GRANT REFERENCES ON TABLE public.sms_delivery_logs TO postgres;

GRANT SELECT ON TABLE public.sms_delivery_logs TO postgres;

GRANT TRIGGER ON TABLE public.sms_delivery_logs TO postgres;

GRANT TRUNCATE ON TABLE public.sms_delivery_logs TO postgres;

GRANT UPDATE ON TABLE public.sms_delivery_logs TO postgres;

GRANT DELETE ON TABLE public.sms_delivery_logs TO anon;

GRANT INSERT ON TABLE public.sms_delivery_logs TO anon;

GRANT MAINTAIN ON TABLE public.sms_delivery_logs TO anon;

GRANT REFERENCES ON TABLE public.sms_delivery_logs TO anon;

GRANT SELECT ON TABLE public.sms_delivery_logs TO anon;

GRANT TRIGGER ON TABLE public.sms_delivery_logs TO anon;

GRANT TRUNCATE ON TABLE public.sms_delivery_logs TO anon;

GRANT UPDATE ON TABLE public.sms_delivery_logs TO anon;

GRANT DELETE ON TABLE public.sms_delivery_logs TO authenticated;

GRANT INSERT ON TABLE public.sms_delivery_logs TO authenticated;

GRANT MAINTAIN ON TABLE public.sms_delivery_logs TO authenticated;

GRANT REFERENCES ON TABLE public.sms_delivery_logs TO authenticated;

GRANT SELECT ON TABLE public.sms_delivery_logs TO authenticated;

GRANT TRIGGER ON TABLE public.sms_delivery_logs TO authenticated;

GRANT TRUNCATE ON TABLE public.sms_delivery_logs TO authenticated;

GRANT UPDATE ON TABLE public.sms_delivery_logs TO authenticated;

GRANT DELETE ON TABLE public.sms_delivery_logs TO service_role;

GRANT INSERT ON TABLE public.sms_delivery_logs TO service_role;

GRANT MAINTAIN ON TABLE public.sms_delivery_logs TO service_role;

GRANT REFERENCES ON TABLE public.sms_delivery_logs TO service_role;

GRANT SELECT ON TABLE public.sms_delivery_logs TO service_role;

GRANT TRIGGER ON TABLE public.sms_delivery_logs TO service_role;

GRANT TRUNCATE ON TABLE public.sms_delivery_logs TO service_role;

GRANT UPDATE ON TABLE public.sms_delivery_logs TO service_role;

GRANT DELETE ON TABLE public.strike_appeals TO postgres;

GRANT INSERT ON TABLE public.strike_appeals TO postgres;

GRANT MAINTAIN ON TABLE public.strike_appeals TO postgres;

GRANT REFERENCES ON TABLE public.strike_appeals TO postgres;

GRANT SELECT ON TABLE public.strike_appeals TO postgres;

GRANT TRIGGER ON TABLE public.strike_appeals TO postgres;

GRANT TRUNCATE ON TABLE public.strike_appeals TO postgres;

GRANT UPDATE ON TABLE public.strike_appeals TO postgres;

GRANT DELETE ON TABLE public.strike_appeals TO anon;

GRANT INSERT ON TABLE public.strike_appeals TO anon;

GRANT MAINTAIN ON TABLE public.strike_appeals TO anon;

GRANT REFERENCES ON TABLE public.strike_appeals TO anon;

GRANT SELECT ON TABLE public.strike_appeals TO anon;

GRANT TRIGGER ON TABLE public.strike_appeals TO anon;

GRANT TRUNCATE ON TABLE public.strike_appeals TO anon;

GRANT UPDATE ON TABLE public.strike_appeals TO anon;

GRANT DELETE ON TABLE public.strike_appeals TO authenticated;

GRANT INSERT ON TABLE public.strike_appeals TO authenticated;

GRANT MAINTAIN ON TABLE public.strike_appeals TO authenticated;

GRANT REFERENCES ON TABLE public.strike_appeals TO authenticated;

GRANT SELECT ON TABLE public.strike_appeals TO authenticated;

GRANT TRIGGER ON TABLE public.strike_appeals TO authenticated;

GRANT TRUNCATE ON TABLE public.strike_appeals TO authenticated;

GRANT UPDATE ON TABLE public.strike_appeals TO authenticated;

GRANT DELETE ON TABLE public.strike_appeals TO service_role;

GRANT INSERT ON TABLE public.strike_appeals TO service_role;

GRANT MAINTAIN ON TABLE public.strike_appeals TO service_role;

GRANT REFERENCES ON TABLE public.strike_appeals TO service_role;

GRANT SELECT ON TABLE public.strike_appeals TO service_role;

GRANT TRIGGER ON TABLE public.strike_appeals TO service_role;

GRANT TRUNCATE ON TABLE public.strike_appeals TO service_role;

GRANT UPDATE ON TABLE public.strike_appeals TO service_role;

GRANT DELETE ON TABLE public.ticket_tiers TO postgres;

GRANT INSERT ON TABLE public.ticket_tiers TO postgres;

GRANT MAINTAIN ON TABLE public.ticket_tiers TO postgres;

GRANT REFERENCES ON TABLE public.ticket_tiers TO postgres;

GRANT SELECT ON TABLE public.ticket_tiers TO postgres;

GRANT TRIGGER ON TABLE public.ticket_tiers TO postgres;

GRANT TRUNCATE ON TABLE public.ticket_tiers TO postgres;

GRANT UPDATE ON TABLE public.ticket_tiers TO postgres;

GRANT DELETE ON TABLE public.ticket_tiers TO anon;

GRANT INSERT ON TABLE public.ticket_tiers TO anon;

GRANT MAINTAIN ON TABLE public.ticket_tiers TO anon;

GRANT REFERENCES ON TABLE public.ticket_tiers TO anon;

GRANT SELECT ON TABLE public.ticket_tiers TO anon;

GRANT TRIGGER ON TABLE public.ticket_tiers TO anon;

GRANT TRUNCATE ON TABLE public.ticket_tiers TO anon;

GRANT UPDATE ON TABLE public.ticket_tiers TO anon;

GRANT DELETE ON TABLE public.ticket_tiers TO authenticated;

GRANT INSERT ON TABLE public.ticket_tiers TO authenticated;

GRANT MAINTAIN ON TABLE public.ticket_tiers TO authenticated;

GRANT REFERENCES ON TABLE public.ticket_tiers TO authenticated;

GRANT SELECT ON TABLE public.ticket_tiers TO authenticated;

GRANT TRIGGER ON TABLE public.ticket_tiers TO authenticated;

GRANT TRUNCATE ON TABLE public.ticket_tiers TO authenticated;

GRANT UPDATE ON TABLE public.ticket_tiers TO authenticated;

GRANT DELETE ON TABLE public.ticket_tiers TO service_role;

GRANT INSERT ON TABLE public.ticket_tiers TO service_role;

GRANT MAINTAIN ON TABLE public.ticket_tiers TO service_role;

GRANT REFERENCES ON TABLE public.ticket_tiers TO service_role;

GRANT SELECT ON TABLE public.ticket_tiers TO service_role;

GRANT TRIGGER ON TABLE public.ticket_tiers TO service_role;

GRANT TRUNCATE ON TABLE public.ticket_tiers TO service_role;

GRANT UPDATE ON TABLE public.ticket_tiers TO service_role;

GRANT DELETE ON TABLE public.tickets TO postgres;

GRANT INSERT ON TABLE public.tickets TO postgres;

GRANT MAINTAIN ON TABLE public.tickets TO postgres;

GRANT REFERENCES ON TABLE public.tickets TO postgres;

GRANT SELECT ON TABLE public.tickets TO postgres;

GRANT TRIGGER ON TABLE public.tickets TO postgres;

GRANT TRUNCATE ON TABLE public.tickets TO postgres;

GRANT UPDATE ON TABLE public.tickets TO postgres;

GRANT DELETE ON TABLE public.tickets TO anon;

GRANT INSERT ON TABLE public.tickets TO anon;

GRANT MAINTAIN ON TABLE public.tickets TO anon;

GRANT REFERENCES ON TABLE public.tickets TO anon;

GRANT SELECT ON TABLE public.tickets TO anon;

GRANT TRIGGER ON TABLE public.tickets TO anon;

GRANT TRUNCATE ON TABLE public.tickets TO anon;

GRANT UPDATE ON TABLE public.tickets TO anon;

GRANT DELETE ON TABLE public.tickets TO authenticated;

GRANT INSERT ON TABLE public.tickets TO authenticated;

GRANT MAINTAIN ON TABLE public.tickets TO authenticated;

GRANT REFERENCES ON TABLE public.tickets TO authenticated;

GRANT SELECT ON TABLE public.tickets TO authenticated;

GRANT TRIGGER ON TABLE public.tickets TO authenticated;

GRANT TRUNCATE ON TABLE public.tickets TO authenticated;

GRANT UPDATE ON TABLE public.tickets TO authenticated;

GRANT DELETE ON TABLE public.tickets TO service_role;

GRANT INSERT ON TABLE public.tickets TO service_role;

GRANT MAINTAIN ON TABLE public.tickets TO service_role;

GRANT REFERENCES ON TABLE public.tickets TO service_role;

GRANT SELECT ON TABLE public.tickets TO service_role;

GRANT TRIGGER ON TABLE public.tickets TO service_role;

GRANT TRUNCATE ON TABLE public.tickets TO service_role;

GRANT UPDATE ON TABLE public.tickets TO service_role;

GRANT DELETE ON TABLE public.transactions TO postgres;

GRANT INSERT ON TABLE public.transactions TO postgres;

GRANT MAINTAIN ON TABLE public.transactions TO postgres;

GRANT REFERENCES ON TABLE public.transactions TO postgres;

GRANT SELECT ON TABLE public.transactions TO postgres;

GRANT TRIGGER ON TABLE public.transactions TO postgres;

GRANT TRUNCATE ON TABLE public.transactions TO postgres;

GRANT UPDATE ON TABLE public.transactions TO postgres;

GRANT DELETE ON TABLE public.transactions TO anon;

GRANT INSERT ON TABLE public.transactions TO anon;

GRANT MAINTAIN ON TABLE public.transactions TO anon;

GRANT REFERENCES ON TABLE public.transactions TO anon;

GRANT SELECT ON TABLE public.transactions TO anon;

GRANT TRIGGER ON TABLE public.transactions TO anon;

GRANT TRUNCATE ON TABLE public.transactions TO anon;

GRANT UPDATE ON TABLE public.transactions TO anon;

GRANT DELETE ON TABLE public.transactions TO authenticated;

GRANT INSERT ON TABLE public.transactions TO authenticated;

GRANT MAINTAIN ON TABLE public.transactions TO authenticated;

GRANT REFERENCES ON TABLE public.transactions TO authenticated;

GRANT SELECT ON TABLE public.transactions TO authenticated;

GRANT TRIGGER ON TABLE public.transactions TO authenticated;

GRANT TRUNCATE ON TABLE public.transactions TO authenticated;

GRANT UPDATE ON TABLE public.transactions TO authenticated;

GRANT DELETE ON TABLE public.transactions TO service_role;

GRANT INSERT ON TABLE public.transactions TO service_role;

GRANT MAINTAIN ON TABLE public.transactions TO service_role;

GRANT REFERENCES ON TABLE public.transactions TO service_role;

GRANT SELECT ON TABLE public.transactions TO service_role;

GRANT TRIGGER ON TABLE public.transactions TO service_role;

GRANT TRUNCATE ON TABLE public.transactions TO service_role;

GRANT UPDATE ON TABLE public.transactions TO service_role;

GRANT DELETE ON TABLE public.typing_status TO postgres;

GRANT INSERT ON TABLE public.typing_status TO postgres;

GRANT MAINTAIN ON TABLE public.typing_status TO postgres;

GRANT REFERENCES ON TABLE public.typing_status TO postgres;

GRANT SELECT ON TABLE public.typing_status TO postgres;

GRANT TRIGGER ON TABLE public.typing_status TO postgres;

GRANT TRUNCATE ON TABLE public.typing_status TO postgres;

GRANT UPDATE ON TABLE public.typing_status TO postgres;

GRANT DELETE ON TABLE public.typing_status TO anon;

GRANT INSERT ON TABLE public.typing_status TO anon;

GRANT MAINTAIN ON TABLE public.typing_status TO anon;

GRANT REFERENCES ON TABLE public.typing_status TO anon;

GRANT SELECT ON TABLE public.typing_status TO anon;

GRANT TRIGGER ON TABLE public.typing_status TO anon;

GRANT TRUNCATE ON TABLE public.typing_status TO anon;

GRANT UPDATE ON TABLE public.typing_status TO anon;

GRANT DELETE ON TABLE public.typing_status TO authenticated;

GRANT INSERT ON TABLE public.typing_status TO authenticated;

GRANT MAINTAIN ON TABLE public.typing_status TO authenticated;

GRANT REFERENCES ON TABLE public.typing_status TO authenticated;

GRANT SELECT ON TABLE public.typing_status TO authenticated;

GRANT TRIGGER ON TABLE public.typing_status TO authenticated;

GRANT TRUNCATE ON TABLE public.typing_status TO authenticated;

GRANT UPDATE ON TABLE public.typing_status TO authenticated;

GRANT DELETE ON TABLE public.typing_status TO service_role;

GRANT INSERT ON TABLE public.typing_status TO service_role;

GRANT MAINTAIN ON TABLE public.typing_status TO service_role;

GRANT REFERENCES ON TABLE public.typing_status TO service_role;

GRANT SELECT ON TABLE public.typing_status TO service_role;

GRANT TRIGGER ON TABLE public.typing_status TO service_role;

GRANT TRUNCATE ON TABLE public.typing_status TO service_role;

GRANT UPDATE ON TABLE public.typing_status TO service_role;

GRANT DELETE ON TABLE public.user_blocks TO postgres;

GRANT INSERT ON TABLE public.user_blocks TO postgres;

GRANT MAINTAIN ON TABLE public.user_blocks TO postgres;

GRANT REFERENCES ON TABLE public.user_blocks TO postgres;

GRANT SELECT ON TABLE public.user_blocks TO postgres;

GRANT TRIGGER ON TABLE public.user_blocks TO postgres;

GRANT TRUNCATE ON TABLE public.user_blocks TO postgres;

GRANT UPDATE ON TABLE public.user_blocks TO postgres;

GRANT DELETE ON TABLE public.user_blocks TO anon;

GRANT INSERT ON TABLE public.user_blocks TO anon;

GRANT MAINTAIN ON TABLE public.user_blocks TO anon;

GRANT REFERENCES ON TABLE public.user_blocks TO anon;

GRANT SELECT ON TABLE public.user_blocks TO anon;

GRANT TRIGGER ON TABLE public.user_blocks TO anon;

GRANT TRUNCATE ON TABLE public.user_blocks TO anon;

GRANT UPDATE ON TABLE public.user_blocks TO anon;

GRANT DELETE ON TABLE public.user_blocks TO authenticated;

GRANT INSERT ON TABLE public.user_blocks TO authenticated;

GRANT MAINTAIN ON TABLE public.user_blocks TO authenticated;

GRANT REFERENCES ON TABLE public.user_blocks TO authenticated;

GRANT SELECT ON TABLE public.user_blocks TO authenticated;

GRANT TRIGGER ON TABLE public.user_blocks TO authenticated;

GRANT TRUNCATE ON TABLE public.user_blocks TO authenticated;

GRANT UPDATE ON TABLE public.user_blocks TO authenticated;

GRANT DELETE ON TABLE public.user_blocks TO service_role;

GRANT INSERT ON TABLE public.user_blocks TO service_role;

GRANT MAINTAIN ON TABLE public.user_blocks TO service_role;

GRANT REFERENCES ON TABLE public.user_blocks TO service_role;

GRANT SELECT ON TABLE public.user_blocks TO service_role;

GRANT TRIGGER ON TABLE public.user_blocks TO service_role;

GRANT TRUNCATE ON TABLE public.user_blocks TO service_role;

GRANT UPDATE ON TABLE public.user_blocks TO service_role;

GRANT DELETE ON TABLE public.user_push_tokens TO postgres;

GRANT INSERT ON TABLE public.user_push_tokens TO postgres;

GRANT MAINTAIN ON TABLE public.user_push_tokens TO postgres;

GRANT REFERENCES ON TABLE public.user_push_tokens TO postgres;

GRANT SELECT ON TABLE public.user_push_tokens TO postgres;

GRANT TRIGGER ON TABLE public.user_push_tokens TO postgres;

GRANT TRUNCATE ON TABLE public.user_push_tokens TO postgres;

GRANT UPDATE ON TABLE public.user_push_tokens TO postgres;

GRANT DELETE ON TABLE public.user_push_tokens TO anon;

GRANT INSERT ON TABLE public.user_push_tokens TO anon;

GRANT MAINTAIN ON TABLE public.user_push_tokens TO anon;

GRANT REFERENCES ON TABLE public.user_push_tokens TO anon;

GRANT SELECT ON TABLE public.user_push_tokens TO anon;

GRANT TRIGGER ON TABLE public.user_push_tokens TO anon;

GRANT TRUNCATE ON TABLE public.user_push_tokens TO anon;

GRANT UPDATE ON TABLE public.user_push_tokens TO anon;

GRANT DELETE ON TABLE public.user_push_tokens TO authenticated;

GRANT INSERT ON TABLE public.user_push_tokens TO authenticated;

GRANT MAINTAIN ON TABLE public.user_push_tokens TO authenticated;

GRANT REFERENCES ON TABLE public.user_push_tokens TO authenticated;

GRANT SELECT ON TABLE public.user_push_tokens TO authenticated;

GRANT TRIGGER ON TABLE public.user_push_tokens TO authenticated;

GRANT TRUNCATE ON TABLE public.user_push_tokens TO authenticated;

GRANT UPDATE ON TABLE public.user_push_tokens TO authenticated;

GRANT DELETE ON TABLE public.user_push_tokens TO service_role;

GRANT INSERT ON TABLE public.user_push_tokens TO service_role;

GRANT MAINTAIN ON TABLE public.user_push_tokens TO service_role;

GRANT REFERENCES ON TABLE public.user_push_tokens TO service_role;

GRANT SELECT ON TABLE public.user_push_tokens TO service_role;

GRANT TRIGGER ON TABLE public.user_push_tokens TO service_role;

GRANT TRUNCATE ON TABLE public.user_push_tokens TO service_role;

GRANT UPDATE ON TABLE public.user_push_tokens TO service_role;

GRANT DELETE ON TABLE public.user_reviews TO postgres;

GRANT INSERT ON TABLE public.user_reviews TO postgres;

GRANT MAINTAIN ON TABLE public.user_reviews TO postgres;

GRANT REFERENCES ON TABLE public.user_reviews TO postgres;

GRANT SELECT ON TABLE public.user_reviews TO postgres;

GRANT TRIGGER ON TABLE public.user_reviews TO postgres;

GRANT TRUNCATE ON TABLE public.user_reviews TO postgres;

GRANT UPDATE ON TABLE public.user_reviews TO postgres;

GRANT DELETE ON TABLE public.user_reviews TO anon;

GRANT INSERT ON TABLE public.user_reviews TO anon;

GRANT MAINTAIN ON TABLE public.user_reviews TO anon;

GRANT REFERENCES ON TABLE public.user_reviews TO anon;

GRANT SELECT ON TABLE public.user_reviews TO anon;

GRANT TRIGGER ON TABLE public.user_reviews TO anon;

GRANT TRUNCATE ON TABLE public.user_reviews TO anon;

GRANT UPDATE ON TABLE public.user_reviews TO anon;

GRANT DELETE ON TABLE public.user_reviews TO authenticated;

GRANT INSERT ON TABLE public.user_reviews TO authenticated;

GRANT MAINTAIN ON TABLE public.user_reviews TO authenticated;

GRANT REFERENCES ON TABLE public.user_reviews TO authenticated;

GRANT SELECT ON TABLE public.user_reviews TO authenticated;

GRANT TRIGGER ON TABLE public.user_reviews TO authenticated;

GRANT TRUNCATE ON TABLE public.user_reviews TO authenticated;

GRANT UPDATE ON TABLE public.user_reviews TO authenticated;

GRANT DELETE ON TABLE public.user_reviews TO service_role;

GRANT INSERT ON TABLE public.user_reviews TO service_role;

GRANT MAINTAIN ON TABLE public.user_reviews TO service_role;

GRANT REFERENCES ON TABLE public.user_reviews TO service_role;

GRANT SELECT ON TABLE public.user_reviews TO service_role;

GRANT TRIGGER ON TABLE public.user_reviews TO service_role;

GRANT TRUNCATE ON TABLE public.user_reviews TO service_role;

GRANT UPDATE ON TABLE public.user_reviews TO service_role;

GRANT DELETE ON TABLE public.users TO postgres;

GRANT INSERT ON TABLE public.users TO postgres;

GRANT MAINTAIN ON TABLE public.users TO postgres;

GRANT REFERENCES ON TABLE public.users TO postgres;

GRANT SELECT ON TABLE public.users TO postgres;

GRANT TRIGGER ON TABLE public.users TO postgres;

GRANT TRUNCATE ON TABLE public.users TO postgres;

GRANT UPDATE ON TABLE public.users TO postgres;

GRANT DELETE ON TABLE public.users TO anon;

GRANT INSERT ON TABLE public.users TO anon;

GRANT MAINTAIN ON TABLE public.users TO anon;

GRANT REFERENCES ON TABLE public.users TO anon;

GRANT SELECT ON TABLE public.users TO anon;

GRANT TRIGGER ON TABLE public.users TO anon;

GRANT TRUNCATE ON TABLE public.users TO anon;

GRANT UPDATE ON TABLE public.users TO anon;

GRANT DELETE ON TABLE public.users TO authenticated;

GRANT INSERT ON TABLE public.users TO authenticated;

GRANT MAINTAIN ON TABLE public.users TO authenticated;

GRANT REFERENCES ON TABLE public.users TO authenticated;

GRANT SELECT ON TABLE public.users TO authenticated;

GRANT TRIGGER ON TABLE public.users TO authenticated;

GRANT TRUNCATE ON TABLE public.users TO authenticated;

GRANT UPDATE ON TABLE public.users TO authenticated;

GRANT DELETE ON TABLE public.users TO service_role;

GRANT INSERT ON TABLE public.users TO service_role;

GRANT MAINTAIN ON TABLE public.users TO service_role;

GRANT REFERENCES ON TABLE public.users TO service_role;

GRANT SELECT ON TABLE public.users TO service_role;

GRANT TRIGGER ON TABLE public.users TO service_role;

GRANT TRUNCATE ON TABLE public.users TO service_role;

GRANT UPDATE ON TABLE public.users TO service_role;

GRANT DELETE ON TABLE public.verification_documents TO postgres;

GRANT INSERT ON TABLE public.verification_documents TO postgres;

GRANT MAINTAIN ON TABLE public.verification_documents TO postgres;

GRANT REFERENCES ON TABLE public.verification_documents TO postgres;

GRANT SELECT ON TABLE public.verification_documents TO postgres;

GRANT TRIGGER ON TABLE public.verification_documents TO postgres;

GRANT TRUNCATE ON TABLE public.verification_documents TO postgres;

GRANT UPDATE ON TABLE public.verification_documents TO postgres;

GRANT DELETE ON TABLE public.verification_documents TO anon;

GRANT INSERT ON TABLE public.verification_documents TO anon;

GRANT MAINTAIN ON TABLE public.verification_documents TO anon;

GRANT REFERENCES ON TABLE public.verification_documents TO anon;

GRANT SELECT ON TABLE public.verification_documents TO anon;

GRANT TRIGGER ON TABLE public.verification_documents TO anon;

GRANT TRUNCATE ON TABLE public.verification_documents TO anon;

GRANT UPDATE ON TABLE public.verification_documents TO anon;

GRANT DELETE ON TABLE public.verification_documents TO authenticated;

GRANT INSERT ON TABLE public.verification_documents TO authenticated;

GRANT MAINTAIN ON TABLE public.verification_documents TO authenticated;

GRANT REFERENCES ON TABLE public.verification_documents TO authenticated;

GRANT SELECT ON TABLE public.verification_documents TO authenticated;

GRANT TRIGGER ON TABLE public.verification_documents TO authenticated;

GRANT TRUNCATE ON TABLE public.verification_documents TO authenticated;

GRANT UPDATE ON TABLE public.verification_documents TO authenticated;

GRANT DELETE ON TABLE public.verification_documents TO service_role;

GRANT INSERT ON TABLE public.verification_documents TO service_role;

GRANT MAINTAIN ON TABLE public.verification_documents TO service_role;

GRANT REFERENCES ON TABLE public.verification_documents TO service_role;

GRANT SELECT ON TABLE public.verification_documents TO service_role;

GRANT TRIGGER ON TABLE public.verification_documents TO service_role;

GRANT TRUNCATE ON TABLE public.verification_documents TO service_role;

GRANT UPDATE ON TABLE public.verification_documents TO service_role;

GRANT SELECT (id) ON TABLE public.disputes TO authenticated;

GRANT SELECT (transaction_id) ON TABLE public.disputes TO authenticated;

GRANT SELECT (opened_by) ON TABLE public.disputes TO authenticated;

GRANT SELECT (dispute_reason) ON TABLE public.disputes TO authenticated;

GRANT SELECT (buyer_evidence) ON TABLE public.disputes TO authenticated;

GRANT SELECT (seller_evidence) ON TABLE public.disputes TO authenticated;

GRANT SELECT (resolution) ON TABLE public.disputes TO authenticated;

GRANT SELECT (status) ON TABLE public.disputes TO authenticated;

GRANT SELECT (resolved_by) ON TABLE public.disputes TO authenticated;

GRANT SELECT (refund_amount) ON TABLE public.disputes TO authenticated;

GRANT SELECT (seller_amount) ON TABLE public.disputes TO authenticated;

GRANT SELECT (created_at) ON TABLE public.disputes TO authenticated;

GRANT SELECT (updated_at) ON TABLE public.disputes TO authenticated;

GRANT SELECT (resolved_at) ON TABLE public.disputes TO authenticated;

GRANT EXECUTE ON FUNCTION abandon_checkout_reservation(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION abandon_checkout_reservation(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION accept_community_invite(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION accept_community_invite(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION accept_community_invite(uuid) TO anon;

GRANT EXECUTE ON FUNCTION accept_community_invite(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION accept_community_invite(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION accept_friend_request(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION accept_friend_request(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION accept_friend_request(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION accept_friend_request(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION adjust_ticket_tier_sold() TO PUBLIC;

GRANT EXECUTE ON FUNCTION adjust_ticket_tier_sold() TO postgres;

GRANT EXECUTE ON FUNCTION adjust_ticket_tier_sold() TO anon;

GRANT EXECUTE ON FUNCTION adjust_ticket_tier_sold() TO authenticated;

GRANT EXECUTE ON FUNCTION adjust_ticket_tier_sold() TO service_role;

GRANT EXECUTE ON FUNCTION append_dispute_evidence(uuid,uuid,jsonb) TO postgres;

GRANT EXECUTE ON FUNCTION append_dispute_evidence(uuid,uuid,jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION apply_escrow_payment(uuid,text,text) TO postgres;

GRANT EXECUTE ON FUNCTION apply_escrow_payment(uuid,text,text) TO service_role;

GRANT EXECUTE ON FUNCTION apply_escrow_refund(uuid,text,numeric) TO postgres;

GRANT EXECUTE ON FUNCTION apply_escrow_refund(uuid,text,numeric) TO service_role;

GRANT EXECUTE ON FUNCTION approve_community_join_request(uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION approve_community_join_request(uuid,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION approve_community_join_request(uuid,uuid) TO anon;

GRANT EXECUTE ON FUNCTION approve_community_join_request(uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION approve_community_join_request(uuid,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION begin_dispute_resolution(uuid,uuid,text,numeric,numeric) TO postgres;

GRANT EXECUTE ON FUNCTION begin_dispute_resolution(uuid,uuid,text,numeric,numeric) TO service_role;

GRANT EXECUTE ON FUNCTION check_message_update_rules() TO PUBLIC;

GRANT EXECUTE ON FUNCTION check_message_update_rules() TO postgres;

GRANT EXECUTE ON FUNCTION check_message_update_rules() TO anon;

GRANT EXECUTE ON FUNCTION check_message_update_rules() TO authenticated;

GRANT EXECUTE ON FUNCTION check_message_update_rules() TO service_role;

GRANT EXECUTE ON FUNCTION cleanup_old_typing_status() TO PUBLIC;

GRANT EXECUTE ON FUNCTION cleanup_old_typing_status() TO postgres;

GRANT EXECUTE ON FUNCTION cleanup_old_typing_status() TO anon;

GRANT EXECUTE ON FUNCTION cleanup_old_typing_status() TO authenticated;

GRANT EXECUTE ON FUNCTION cleanup_old_typing_status() TO service_role;

GRANT EXECUTE ON FUNCTION clear_all_notifications(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION clear_all_notifications(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION clear_all_notifications(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION clear_all_notifications(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION community_toggle_post_like(uuid,uuid,text) TO postgres;

GRANT EXECUTE ON FUNCTION community_toggle_post_like(uuid,uuid,text) TO anon;

GRANT EXECUTE ON FUNCTION community_toggle_post_like(uuid,uuid,text) TO authenticated;

GRANT EXECUTE ON FUNCTION community_toggle_post_like(uuid,uuid,text) TO service_role;

GRANT EXECUTE ON FUNCTION consume_rate_limit(uuid,text,integer,integer) TO postgres;

GRANT EXECUTE ON FUNCTION consume_rate_limit(uuid,text,integer,integer) TO service_role;

GRANT EXECUTE ON FUNCTION create_checkout_reservation(jsonb) TO postgres;

GRANT EXECUTE ON FUNCTION create_checkout_reservation(jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION create_notification(uuid,character varying,character varying,text,uuid,uuid,character varying,jsonb) TO PUBLIC;

GRANT EXECUTE ON FUNCTION create_notification(uuid,character varying,character varying,text,uuid,uuid,character varying,jsonb) TO postgres;

GRANT EXECUTE ON FUNCTION create_notification(uuid,character varying,character varying,text,uuid,uuid,character varying,jsonb) TO anon;

GRANT EXECUTE ON FUNCTION create_notification(uuid,character varying,character varying,text,uuid,uuid,character varying,jsonb) TO authenticated;

GRANT EXECUTE ON FUNCTION create_notification(uuid,character varying,character varying,text,uuid,uuid,character varying,jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION finish_dispute_resolution(uuid,text) TO postgres;

GRANT EXECUTE ON FUNCTION finish_dispute_resolution(uuid,text) TO service_role;

GRANT EXECUTE ON FUNCTION flag_dispute_resolution_reconciliation(uuid,text) TO postgres;

GRANT EXECUTE ON FUNCTION flag_dispute_resolution_reconciliation(uuid,text) TO service_role;

GRANT EXECUTE ON FUNCTION fn_auto_join_ward_community() TO PUBLIC;

GRANT EXECUTE ON FUNCTION fn_auto_join_ward_community() TO postgres;

GRANT EXECUTE ON FUNCTION fn_auto_join_ward_community() TO anon;

GRANT EXECUTE ON FUNCTION fn_auto_join_ward_community() TO authenticated;

GRANT EXECUTE ON FUNCTION fn_auto_join_ward_community() TO service_role;

GRANT EXECUTE ON FUNCTION fn_check_community_post_rate_limit() TO PUBLIC;

GRANT EXECUTE ON FUNCTION fn_check_community_post_rate_limit() TO postgres;

GRANT EXECUTE ON FUNCTION fn_check_community_post_rate_limit() TO anon;

GRANT EXECUTE ON FUNCTION fn_check_community_post_rate_limit() TO authenticated;

GRANT EXECUTE ON FUNCTION fn_check_community_post_rate_limit() TO service_role;

GRANT EXECUTE ON FUNCTION fn_community_comment_count() TO PUBLIC;

GRANT EXECUTE ON FUNCTION fn_community_comment_count() TO postgres;

GRANT EXECUTE ON FUNCTION fn_community_comment_count() TO anon;

GRANT EXECUTE ON FUNCTION fn_community_comment_count() TO authenticated;

GRANT EXECUTE ON FUNCTION fn_community_comment_count() TO service_role;

GRANT EXECUTE ON FUNCTION fn_community_member_count() TO PUBLIC;

GRANT EXECUTE ON FUNCTION fn_community_member_count() TO postgres;

GRANT EXECUTE ON FUNCTION fn_community_member_count() TO anon;

GRANT EXECUTE ON FUNCTION fn_community_member_count() TO authenticated;

GRANT EXECUTE ON FUNCTION fn_community_member_count() TO service_role;

GRANT EXECUTE ON FUNCTION fn_community_owner_on_approval() TO postgres;

GRANT EXECUTE ON FUNCTION fn_community_owner_on_approval() TO service_role;

GRANT EXECUTE ON FUNCTION get_friends_locations(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION get_friends_locations(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION get_friends_locations(uuid) TO anon;

GRANT EXECUTE ON FUNCTION get_friends_locations(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION get_friends_locations(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION get_location_filtered_businesses(text,text,text,integer) TO PUBLIC;

GRANT EXECUTE ON FUNCTION get_location_filtered_businesses(text,text,text,integer) TO postgres;

GRANT EXECUTE ON FUNCTION get_location_filtered_businesses(text,text,text,integer) TO anon;

GRANT EXECUTE ON FUNCTION get_location_filtered_businesses(text,text,text,integer) TO authenticated;

GRANT EXECUTE ON FUNCTION get_location_filtered_businesses(text,text,text,integer) TO service_role;

GRANT EXECUTE ON FUNCTION get_location_filtered_posts(text,text,text,text,integer) TO PUBLIC;

GRANT EXECUTE ON FUNCTION get_location_filtered_posts(text,text,text,text,integer) TO postgres;

GRANT EXECUTE ON FUNCTION get_location_filtered_posts(text,text,text,text,integer) TO anon;

GRANT EXECUTE ON FUNCTION get_location_filtered_posts(text,text,text,text,integer) TO authenticated;

GRANT EXECUTE ON FUNCTION get_location_filtered_posts(text,text,text,text,integer) TO service_role;

GRANT EXECUTE ON FUNCTION get_mutual_friends(uuid,integer,integer) TO PUBLIC;

GRANT EXECUTE ON FUNCTION get_mutual_friends(uuid,integer,integer) TO postgres;

GRANT EXECUTE ON FUNCTION get_mutual_friends(uuid,integer,integer) TO authenticated;

GRANT EXECUTE ON FUNCTION get_mutual_friends(uuid,integer,integer) TO service_role;

GRANT EXECUTE ON FUNCTION get_users_within_radius_with_push_token(double precision,double precision,integer) TO PUBLIC;

GRANT EXECUTE ON FUNCTION get_users_within_radius_with_push_token(double precision,double precision,integer) TO postgres;

GRANT EXECUTE ON FUNCTION get_users_within_radius_with_push_token(double precision,double precision,integer) TO anon;

GRANT EXECUTE ON FUNCTION get_users_within_radius_with_push_token(double precision,double precision,integer) TO authenticated;

GRANT EXECUTE ON FUNCTION get_users_within_radius_with_push_token(double precision,double precision,integer) TO service_role;

GRANT EXECUTE ON FUNCTION guard_booking_payment_and_status() TO PUBLIC;

GRANT EXECUTE ON FUNCTION guard_booking_payment_and_status() TO postgres;

GRANT EXECUTE ON FUNCTION guard_booking_payment_and_status() TO anon;

GRANT EXECUTE ON FUNCTION guard_booking_payment_and_status() TO authenticated;

GRANT EXECUTE ON FUNCTION guard_booking_payment_and_status() TO service_role;

GRANT EXECUTE ON FUNCTION guard_community_content() TO PUBLIC;

GRANT EXECUTE ON FUNCTION guard_community_content() TO postgres;

GRANT EXECUTE ON FUNCTION guard_community_content() TO anon;

GRANT EXECUTE ON FUNCTION guard_community_content() TO authenticated;

GRANT EXECUTE ON FUNCTION guard_community_content() TO service_role;

GRANT EXECUTE ON FUNCTION guard_community_membership_update() TO PUBLIC;

GRANT EXECUTE ON FUNCTION guard_community_membership_update() TO postgres;

GRANT EXECUTE ON FUNCTION guard_community_membership_update() TO anon;

GRANT EXECUTE ON FUNCTION guard_community_membership_update() TO authenticated;

GRANT EXECUTE ON FUNCTION guard_community_membership_update() TO service_role;

GRANT EXECUTE ON FUNCTION guard_quote_request_write() TO PUBLIC;

GRANT EXECUTE ON FUNCTION guard_quote_request_write() TO postgres;

GRANT EXECUTE ON FUNCTION guard_quote_request_write() TO anon;

GRANT EXECUTE ON FUNCTION guard_quote_request_write() TO authenticated;

GRANT EXECUTE ON FUNCTION guard_quote_request_write() TO service_role;

GRANT EXECUTE ON FUNCTION guard_suspension_fields() TO PUBLIC;

GRANT EXECUTE ON FUNCTION guard_suspension_fields() TO postgres;

GRANT EXECUTE ON FUNCTION guard_suspension_fields() TO anon;

GRANT EXECUTE ON FUNCTION guard_suspension_fields() TO authenticated;

GRANT EXECUTE ON FUNCTION guard_suspension_fields() TO service_role;

GRANT EXECUTE ON FUNCTION guard_ticket_client_update() TO PUBLIC;

GRANT EXECUTE ON FUNCTION guard_ticket_client_update() TO postgres;

GRANT EXECUTE ON FUNCTION guard_ticket_client_update() TO anon;

GRANT EXECUTE ON FUNCTION guard_ticket_client_update() TO authenticated;

GRANT EXECUTE ON FUNCTION guard_ticket_client_update() TO service_role;

GRANT EXECUTE ON FUNCTION handle_phone_verified() TO postgres;

GRANT EXECUTE ON FUNCTION handle_phone_verified() TO service_role;

GRANT EXECUTE ON FUNCTION increment_business_view(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION increment_business_view(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION increment_business_view(uuid) TO anon;

GRANT EXECUTE ON FUNCTION increment_business_view(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION increment_business_view(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION increment_event_share(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION increment_event_share(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION increment_event_share(uuid) TO anon;

GRANT EXECUTE ON FUNCTION increment_event_share(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION increment_event_share(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION increment_post_share(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION increment_post_share(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION increment_post_share(uuid) TO anon;

GRANT EXECUTE ON FUNCTION increment_post_share(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION increment_post_share(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION is_community_mod_or_admin(uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION is_community_mod_or_admin(uuid,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION is_community_mod_or_admin(uuid,uuid) TO anon;

GRANT EXECUTE ON FUNCTION is_community_mod_or_admin(uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION is_community_mod_or_admin(uuid,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION is_conversation_participant(uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION is_conversation_participant(uuid,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION is_conversation_participant(uuid,uuid) TO anon;

GRANT EXECUTE ON FUNCTION is_conversation_participant(uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION is_conversation_participant(uuid,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION is_messages_participant(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION is_messages_participant(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION is_messages_participant(uuid) TO anon;

GRANT EXECUTE ON FUNCTION is_messages_participant(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION is_messages_participant(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION mark_all_notifications_read(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION mark_all_notifications_read(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION mark_all_notifications_read(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION mark_all_notifications_read(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION mark_messages_as_read(uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION mark_messages_as_read(uuid,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION mark_messages_as_read(uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION mark_messages_as_read(uuid,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION mark_notification_read(uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION mark_notification_read(uuid,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION mark_notification_read(uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION mark_notification_read(uuid,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION open_marketplace_dispute(uuid,uuid,text,jsonb) TO postgres;

GRANT EXECUTE ON FUNCTION open_marketplace_dispute(uuid,uuid,text,jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION prevent_business_self_review() TO PUBLIC;

GRANT EXECUTE ON FUNCTION prevent_business_self_review() TO postgres;

GRANT EXECUTE ON FUNCTION prevent_business_self_review() TO anon;

GRANT EXECUTE ON FUNCTION prevent_business_self_review() TO authenticated;

GRANT EXECUTE ON FUNCTION prevent_business_self_review() TO service_role;

GRANT EXECUTE ON FUNCTION prevent_client_admin_escalation() TO postgres;

GRANT EXECUTE ON FUNCTION prevent_client_admin_escalation() TO anon;

GRANT EXECUTE ON FUNCTION prevent_client_admin_escalation() TO authenticated;

GRANT EXECUTE ON FUNCTION prevent_client_admin_escalation() TO service_role;

GRANT EXECUTE ON FUNCTION prevent_paid_marketplace_listing_delete() TO PUBLIC;

GRANT EXECUTE ON FUNCTION prevent_paid_marketplace_listing_delete() TO postgres;

GRANT EXECUTE ON FUNCTION prevent_paid_marketplace_listing_delete() TO anon;

GRANT EXECUTE ON FUNCTION prevent_paid_marketplace_listing_delete() TO authenticated;

GRANT EXECUTE ON FUNCTION prevent_paid_marketplace_listing_delete() TO service_role;

GRANT EXECUTE ON FUNCTION purchase_ticket(uuid,uuid,uuid,text,text,text,numeric,text,text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION purchase_ticket(uuid,uuid,uuid,text,text,text,numeric,text,text) TO postgres;

GRANT EXECUTE ON FUNCTION purchase_ticket(uuid,uuid,uuid,text,text,text,numeric,text,text) TO authenticated;

GRANT EXECUTE ON FUNCTION purchase_ticket(uuid,uuid,uuid,text,text,text,numeric,text,text) TO service_role;

GRANT EXECUTE ON FUNCTION queue_community_content_for_moderation() TO PUBLIC;

GRANT EXECUTE ON FUNCTION queue_community_content_for_moderation() TO postgres;

GRANT EXECUTE ON FUNCTION queue_community_content_for_moderation() TO anon;

GRANT EXECUTE ON FUNCTION queue_community_content_for_moderation() TO authenticated;

GRANT EXECUTE ON FUNCTION queue_community_content_for_moderation() TO service_role;

GRANT EXECUTE ON FUNCTION reconcile_dispute_resolution(uuid,uuid,text,text) TO postgres;

GRANT EXECUTE ON FUNCTION reconcile_dispute_resolution(uuid,uuid,text,text) TO service_role;

GRANT EXECUTE ON FUNCTION refresh_business_review_rating(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION refresh_business_review_rating(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION refresh_seller_review_aggregate(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION refresh_seller_review_aggregate(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION refresh_seller_review_aggregate(uuid) TO anon;

GRANT EXECUTE ON FUNCTION refresh_seller_review_aggregate(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION refresh_seller_review_aggregate(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION release_catalog_stock(uuid,integer) TO postgres;

GRANT EXECUTE ON FUNCTION release_catalog_stock(uuid,integer) TO service_role;

GRANT EXECUTE ON FUNCTION remove_friend(uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION remove_friend(uuid) TO postgres;

GRANT EXECUTE ON FUNCTION remove_friend(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION remove_friend(uuid) TO service_role;

GRANT EXECUTE ON FUNCTION remove_notification_actor(uuid,character varying,uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION remove_notification_actor(uuid,character varying,uuid,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION remove_notification_actor(uuid,character varying,uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION remove_notification_actor(uuid,character varying,uuid,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION requeue_seller_payout(uuid,uuid,numeric) TO postgres;

GRANT EXECUTE ON FUNCTION requeue_seller_payout(uuid,uuid,numeric) TO service_role;

GRANT EXECUTE ON FUNCTION reserve_catalog_stock(uuid,integer) TO postgres;

GRANT EXECUTE ON FUNCTION reserve_catalog_stock(uuid,integer) TO service_role;

GRANT EXECUTE ON FUNCTION reserve_seller_payout(uuid,uuid,numeric,numeric,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION reserve_seller_payout(uuid,uuid,numeric,numeric,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION reset_conversation_deleted_by() TO PUBLIC;

GRANT EXECUTE ON FUNCTION reset_conversation_deleted_by() TO postgres;

GRANT EXECUTE ON FUNCTION reset_conversation_deleted_by() TO anon;

GRANT EXECUTE ON FUNCTION reset_conversation_deleted_by() TO authenticated;

GRANT EXECUTE ON FUNCTION reset_conversation_deleted_by() TO service_role;

GRANT EXECUTE ON FUNCTION scan_ticket(text,uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION scan_ticket(text,uuid,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION scan_ticket(text,uuid,uuid) TO anon;

GRANT EXECUTE ON FUNCTION scan_ticket(text,uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scan_ticket(text,uuid,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION scan_ticket(uuid,uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION scan_ticket(uuid,uuid,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION scan_ticket(uuid,uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION scan_ticket(uuid,uuid,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION search_posts_by_distance(double precision,double precision,double precision,text,double precision,double precision,text,text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION search_posts_by_distance(double precision,double precision,double precision,text,double precision,double precision,text,text) TO postgres;

GRANT EXECUTE ON FUNCTION search_posts_by_distance(double precision,double precision,double precision,text,double precision,double precision,text,text) TO anon;

GRANT EXECUTE ON FUNCTION search_posts_by_distance(double precision,double precision,double precision,text,double precision,double precision,text,text) TO authenticated;

GRANT EXECUTE ON FUNCTION search_posts_by_distance(double precision,double precision,double precision,text,double precision,double precision,text,text) TO service_role;

GRANT EXECUTE ON FUNCTION set_business_location_from_user() TO PUBLIC;

GRANT EXECUTE ON FUNCTION set_business_location_from_user() TO postgres;

GRANT EXECUTE ON FUNCTION set_business_location_from_user() TO anon;

GRANT EXECUTE ON FUNCTION set_business_location_from_user() TO authenticated;

GRANT EXECUTE ON FUNCTION set_business_location_from_user() TO service_role;

GRANT EXECUTE ON FUNCTION set_post_location_from_user() TO PUBLIC;

GRANT EXECUTE ON FUNCTION set_post_location_from_user() TO postgres;

GRANT EXECUTE ON FUNCTION set_post_location_from_user() TO anon;

GRANT EXECUTE ON FUNCTION set_post_location_from_user() TO authenticated;

GRANT EXECUTE ON FUNCTION set_post_location_from_user() TO service_role;

GRANT EXECUTE ON FUNCTION sync_business_review_aggregate() TO postgres;

GRANT EXECUTE ON FUNCTION sync_business_review_aggregate() TO service_role;

GRANT EXECUTE ON FUNCTION sync_business_review_rating() TO postgres;

GRANT EXECUTE ON FUNCTION sync_business_review_rating() TO service_role;

GRANT EXECUTE ON FUNCTION sync_ticket_checked_in() TO PUBLIC;

GRANT EXECUTE ON FUNCTION sync_ticket_checked_in() TO postgres;

GRANT EXECUTE ON FUNCTION sync_ticket_checked_in() TO anon;

GRANT EXECUTE ON FUNCTION sync_ticket_checked_in() TO authenticated;

GRANT EXECUTE ON FUNCTION sync_ticket_checked_in() TO service_role;

GRANT EXECUTE ON FUNCTION sync_user_review_aggregate() TO postgres;

GRANT EXECUTE ON FUNCTION sync_user_review_aggregate() TO service_role;

GRANT EXECUTE ON FUNCTION toggle_post_like(uuid,uuid) TO PUBLIC;

GRANT EXECUTE ON FUNCTION toggle_post_like(uuid,uuid) TO postgres;

GRANT EXECUTE ON FUNCTION toggle_post_like(uuid,uuid) TO anon;

GRANT EXECUTE ON FUNCTION toggle_post_like(uuid,uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION toggle_post_like(uuid,uuid) TO service_role;

GRANT EXECUTE ON FUNCTION tr_update_post_comment_count() TO PUBLIC;

GRANT EXECUTE ON FUNCTION tr_update_post_comment_count() TO postgres;

GRANT EXECUTE ON FUNCTION tr_update_post_comment_count() TO anon;

GRANT EXECUTE ON FUNCTION tr_update_post_comment_count() TO authenticated;

GRANT EXECUTE ON FUNCTION tr_update_post_comment_count() TO service_role;

GRANT EXECUTE ON FUNCTION trigger_cleanup_typing_status() TO PUBLIC;

GRANT EXECUTE ON FUNCTION trigger_cleanup_typing_status() TO postgres;

GRANT EXECUTE ON FUNCTION trigger_cleanup_typing_status() TO anon;

GRANT EXECUTE ON FUNCTION trigger_cleanup_typing_status() TO authenticated;

GRANT EXECUTE ON FUNCTION trigger_cleanup_typing_status() TO service_role;

GRANT EXECUTE ON FUNCTION update_business_rating() TO postgres;

GRANT EXECUTE ON FUNCTION update_business_rating() TO service_role;

GRANT EXECUTE ON FUNCTION update_business_staff_updated_at() TO PUBLIC;

GRANT EXECUTE ON FUNCTION update_business_staff_updated_at() TO postgres;

GRANT EXECUTE ON FUNCTION update_business_staff_updated_at() TO anon;

GRANT EXECUTE ON FUNCTION update_business_staff_updated_at() TO authenticated;

GRANT EXECUTE ON FUNCTION update_business_staff_updated_at() TO service_role;

GRANT EXECUTE ON FUNCTION update_comment_like_count() TO PUBLIC;

GRANT EXECUTE ON FUNCTION update_comment_like_count() TO postgres;

GRANT EXECUTE ON FUNCTION update_comment_like_count() TO anon;

GRANT EXECUTE ON FUNCTION update_comment_like_count() TO authenticated;

GRANT EXECUTE ON FUNCTION update_comment_like_count() TO service_role;

GRANT EXECUTE ON FUNCTION update_conversation_last_message() TO PUBLIC;

GRANT EXECUTE ON FUNCTION update_conversation_last_message() TO postgres;

GRANT EXECUTE ON FUNCTION update_conversation_last_message() TO anon;

GRANT EXECUTE ON FUNCTION update_conversation_last_message() TO authenticated;

GRANT EXECUTE ON FUNCTION update_conversation_last_message() TO service_role;

GRANT EXECUTE ON FUNCTION update_notifications_updated_at() TO PUBLIC;

GRANT EXECUTE ON FUNCTION update_notifications_updated_at() TO postgres;

GRANT EXECUTE ON FUNCTION update_notifications_updated_at() TO anon;

GRANT EXECUTE ON FUNCTION update_notifications_updated_at() TO authenticated;

GRANT EXECUTE ON FUNCTION update_notifications_updated_at() TO service_role;

GRANT EXECUTE ON FUNCTION update_quote_requests_updated_at() TO PUBLIC;

GRANT EXECUTE ON FUNCTION update_quote_requests_updated_at() TO postgres;

GRANT EXECUTE ON FUNCTION update_quote_requests_updated_at() TO anon;

GRANT EXECUTE ON FUNCTION update_quote_requests_updated_at() TO authenticated;

GRANT EXECUTE ON FUNCTION update_quote_requests_updated_at() TO service_role;

GRANT EXECUTE ON FUNCTION update_seller_rating() TO postgres;

GRANT EXECUTE ON FUNCTION update_seller_rating() TO service_role;

GRANT EXECUTE ON FUNCTION update_updated_at_column() TO PUBLIC;

GRANT EXECUTE ON FUNCTION update_updated_at_column() TO postgres;

GRANT EXECUTE ON FUNCTION update_updated_at_column() TO anon;

GRANT EXECUTE ON FUNCTION update_updated_at_column() TO authenticated;

GRANT EXECUTE ON FUNCTION update_updated_at_column() TO service_role;

GRANT EXECUTE ON FUNCTION update_user_location(uuid,numeric,numeric,text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION update_user_location(uuid,numeric,numeric,text) TO postgres;

GRANT EXECUTE ON FUNCTION update_user_location(uuid,numeric,numeric,text) TO anon;

GRANT EXECUTE ON FUNCTION update_user_location(uuid,numeric,numeric,text) TO authenticated;

GRANT EXECUTE ON FUNCTION update_user_location(uuid,numeric,numeric,text) TO service_role;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('bank-logos','bank-logos',true,NULL,NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('brand-assets','brand-assets',true,NULL,NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('catalog-items','catalog-items',true,NULL,NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('chat-images','chat-images',true,10485760,ARRAY['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif','image/avif']::text[]) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('chat-videos','chat-videos',true,15728640,ARRAY['video/mp4','video/webm','video/quicktime']::text[]) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('community-images','community-images',true,10485760,ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif']::text[]) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('dispute-evidence','dispute-evidence',false,10485760,ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']::text[]) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('pending-moderation','pending-moderation',false,NULL,NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('post-images','post-images',true,10485760,ARRAY['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif','image/avif']::text[]) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('post-videos','post-videos',true,15728640,ARRAY['video/mp4','video/webm','video/quicktime']::text[]) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('quarantine','quarantine',false,NULL,NULL) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('reports','reports',true,5242880,ARRAY['image/jpeg','image/png','image/webp']::text[]) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES ('user-avatars','user-avatars',true,5242880,ARRAY['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif','image/avif']::text[]) ON CONFLICT (id) DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE public."business_messages";

ALTER PUBLICATION supabase_realtime ADD TABLE public."business_reviews";

ALTER PUBLICATION supabase_realtime ADD TABLE public."businesses";

ALTER PUBLICATION supabase_realtime ADD TABLE public."catalog_items";

ALTER PUBLICATION supabase_realtime ADD TABLE public."chat_messages";

ALTER PUBLICATION supabase_realtime ADD TABLE public."comments";

ALTER PUBLICATION supabase_realtime ADD TABLE public."conversations";

ALTER PUBLICATION supabase_realtime ADD TABLE public."escrow_transactions";

ALTER PUBLICATION supabase_realtime ADD TABLE public."friend_requests";

ALTER PUBLICATION supabase_realtime ADD TABLE public."item_chats";

ALTER PUBLICATION supabase_realtime ADD TABLE public."messages";

ALTER PUBLICATION supabase_realtime ADD TABLE public."notifications";

ALTER PUBLICATION supabase_realtime ADD TABLE public."payout_requests";

ALTER PUBLICATION supabase_realtime ADD TABLE public."posts";

ALTER PUBLICATION supabase_realtime ADD TABLE public."push_subscriptions";

ALTER PUBLICATION supabase_realtime ADD TABLE public."seller_accounts";

ALTER PUBLICATION supabase_realtime ADD TABLE public."users";

ALTER PUBLICATION supabase_realtime ADD TABLE public."verification_documents";

NOTIFY pgrst, 'reload schema';

COMMIT;