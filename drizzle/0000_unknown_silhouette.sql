-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE SEQUENCE "public"."profile_member_number_seq" INCREMENT BY 10 MINVALUE 9 MAXVALUE 9223372036854775807 START WITH 9 CACHE 1;--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"applicant_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_listing_id_applicant_id_key" UNIQUE("applicant_id","listing_id"),
	CONSTRAINT "applications_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text]))
);
--> statement-breakpoint
ALTER TABLE "applications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blog_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name_en" text NOT NULL,
	"name_km" text NOT NULL,
	"description_en" text,
	"description_km" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "blog_categories_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "blog_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"telegram_chat_id" text,
	"telegram_webhook_url" text,
	"telegram_webhook_secret" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK (id = 1)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_stock_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_stock_notifications_item_id_user_id_key" UNIQUE("item_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "catalog_stock_notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_send_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text,
	"template_name" text NOT NULL,
	"recipient_email" text NOT NULL,
	"status" text NOT NULL,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_send_log_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'sent'::text, 'suppressed'::text, 'failed'::text, 'bounced'::text, 'complained'::text, 'dlq'::text]))
);
--> statement-breakpoint
ALTER TABLE "email_send_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "device_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider" text DEFAULT 'unknown' NOT NULL,
	CONSTRAINT "device_tokens_user_id_token_key" UNIQUE("token","user_id")
);
--> statement-breakpoint
ALTER TABLE "device_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "comment_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_likes_comment_id_user_id_key" UNIQUE("comment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "comment_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_send_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"retry_after_until" timestamp with time zone,
	"batch_size" integer DEFAULT 10 NOT NULL,
	"send_delay_ms" integer DEFAULT 200 NOT NULL,
	"auth_email_ttl_minutes" integer DEFAULT 15 NOT NULL,
	"transactional_email_ttl_minutes" integer DEFAULT 60 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_send_state_id_check" CHECK (id = 1)
);
--> statement-breakpoint
ALTER TABLE "email_send_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_unsubscribe_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "email_unsubscribe_tokens_email_key" UNIQUE("email"),
	CONSTRAINT "email_unsubscribe_tokens_token_key" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "email_unsubscribe_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invite_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"inviter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite_clicks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_code_key" UNIQUE("code"),
	CONSTRAINT "invite_codes_user_id_key" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "invite_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invite_joins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inviter_id" uuid NOT NULL,
	"invitee_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_joins_invitee_id_key" UNIQUE("invitee_id"),
	CONSTRAINT "invite_joins_inviter_invitee_unique" UNIQUE("invitee_id","inviter_id")
);
--> statement-breakpoint
ALTER TABLE "invite_joins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invite_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "invite_rewards_user_id_tier_key" UNIQUE("tier","user_id")
);
--> statement-breakpoint
ALTER TABLE "invite_rewards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_photos_photo_url_size_chk" CHECK (octet_length(photo_url) <= 2621440)) NOT VALID)
);
--> statement-breakpoint
ALTER TABLE "listing_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date DEFAULT CURRENT_DATE NOT NULL,
	"available" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "daily_availability_user_id_date_key" UNIQUE("date","user_id"),
	CONSTRAINT "daily_availability_status_chk" CHECK (status = ANY (ARRAY['available'::text, 'busy'::text, 'available_soon'::text]))
);
--> statement-breakpoint
ALTER TABLE "daily_availability" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_search_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"province" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_search_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_stock_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text DEFAULT 'unavailable' NOT NULL,
	"note" text,
	"report_day" date DEFAULT CURRENT_DATE NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_stock_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_km" text NOT NULL,
	"group_en" text NOT NULL,
	"group_km" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_code_key" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_a" uuid NOT NULL,
	"participant_b" uuid NOT NULL,
	"last_message" text,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pinned_post_id" uuid,
	CONSTRAINT "message_threads_participant_a_participant_b_key" UNIQUE("participant_a","participant_b"),
	CONSTRAINT "participants_ordered" CHECK (participant_a < participant_b)
);
--> statement-breakpoint
ALTER TABLE "message_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "portfolio_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_photos_photo_url_size_chk" CHECK (octet_length(photo_url) <= 2621440)) NOT VALID)
);
--> statement-breakpoint
ALTER TABLE "portfolio_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_id" uuid
);
--> statement-breakpoint
ALTER TABLE "post_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "material_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"quantity" integer NOT NULL,
	"note" text,
	"location_filter" text DEFAULT 'near_me' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_requests_category_check" CHECK (category = ANY (ARRAY['electrical'::text, 'cement'::text, 'steel'::text, 'zinc'::text, 'tools'::text, 'timber'::text, 'sanitary'::text, 'paint'::text, 'other'::text])),
	CONSTRAINT "material_requests_location_filter_check" CHECK (location_filter = ANY (ARRAY['near_me'::text, 'anywhere'::text])),
	CONSTRAINT "material_requests_quantity_check" CHECK (quantity > 0),
	CONSTRAINT "material_requests_status_check" CHECK (status = ANY (ARRAY['active'::text, 'found'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "material_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "material_request_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "material_request_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"related_user_id" uuid,
	"related_listing_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"related_post_id" uuid,
	"related_project_id" uuid
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_photos_photo_url_size_chk" CHECK (octet_length(photo_url) <= 2621440)) NOT VALID)
);
--> statement-breakpoint
ALTER TABLE "post_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "material_request_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"response" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_request_responses_request_id_supplier_id_key" UNIQUE("request_id","supplier_id"),
	CONSTRAINT "material_request_responses_response_check" CHECK (response = ANY (ARRAY['available'::text, 'unavailable'::text]))
);
--> statement-breakpoint
ALTER TABLE "material_request_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text,
	"video_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejected_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"post_type" text DEFAULT 'general' NOT NULL,
	"title" text,
	"price" numeric(12, 2),
	"discount_price" numeric,
	"currency" text DEFAULT 'USD' NOT NULL,
	"category" text,
	CONSTRAINT "posts_currency_check" CHECK (currency = ANY (ARRAY['USD'::text, 'KHR'::text])),
	CONSTRAINT "posts_post_type_check" CHECK (post_type = ANY (ARRAY['general'::text, 'novedad'::text, 'stock'::text, 'oferta'::text, 'liquidacion'::text])),
	CONSTRAINT "posts_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))
);
--> statement-breakpoint
ALTER TABLE "posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"budget" numeric,
	"location" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rejected_at" timestamp with time zone,
	"currency" text DEFAULT 'USD' NOT NULL,
	CONSTRAINT "listings_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'rejected'::text, 'closed'::text, 'finished'::text]))
);
--> statement-breakpoint
ALTER TABLE "listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lottery_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draw_type" text NOT NULL,
	"draw_date" date NOT NULL,
	"prize_title" text NOT NULL,
	"prize_description" text,
	"prize_image_url" text,
	"winner_user_id" uuid,
	"winning_ticket_id" uuid,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"drawn_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lottery_draws_draw_type_draw_date_key" UNIQUE("draw_date","draw_type"),
	CONSTRAINT "lottery_draws_draw_type_check" CHECK (draw_type = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])),
	CONSTRAINT "lottery_draws_status_check" CHECK (status = ANY (ARRAY['scheduled'::text, 'drawn'::text, 'published'::text, 'no_entries'::text]))
);
--> statement-breakpoint
ALTER TABLE "lottery_draws" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lottery_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ticket_type" text NOT NULL,
	"draw_period_start" date NOT NULL,
	"source" text DEFAULT 'availability' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ticket_number" integer,
	CONSTRAINT "lottery_tickets_status_check" CHECK (status = ANY (ARRAY['active'::text, 'expired'::text, 'won'::text])),
	CONSTRAINT "lottery_tickets_ticket_type_check" CHECK (ticket_type = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text]))
);
--> statement-breakpoint
ALTER TABLE "lottery_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"content" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_content_length" CHECK (char_length(content) <= 10485760)
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "password_reset_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone_digits" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"log_type" text NOT NULL,
	"photo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_logs_log_type_check" CHECK (log_type = ANY (ARRAY['checkin'::text, 'checkout'::text, 'photo'::text]))
);
--> statement-breakpoint
ALTER TABLE "project_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"rated_id" uuid NOT NULL,
	"stars" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_ratings_project_id_rater_id_key" UNIQUE("project_id","rater_id"),
	CONSTRAINT "project_ratings_comment_check" CHECK ((comment IS NULL) OR (char_length(comment) <= 100)),
	CONSTRAINT "project_ratings_stars_check" CHECK ((stars >= 1) AND (stars <= 5))
);
--> statement-breakpoint
ALTER TABLE "project_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"agreed_price" numeric,
	"checkin_required" boolean DEFAULT false NOT NULL,
	"checkout_required" boolean DEFAULT false NOT NULL,
	"photo_frequency" text,
	"start_date" date,
	"duration" text,
	"completion_requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"setup_completed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "projects_check" CHECK (owner_id <> worker_id),
	CONSTRAINT "projects_photo_frequency_check" CHECK (photo_frequency = ANY (ARRAY['morning'::text, 'midday'::text, 'endofday'::text])),
	CONSTRAINT "projects_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'active'::text, 'declined'::text, 'completed'::text, 'cancelled'::text]))
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "story_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"story_id" uuid NOT NULL,
	"viewer_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_views_story_id_viewer_id_key" UNIQUE("story_id","viewer_id")
);
--> statement-breakpoint
ALTER TABLE "story_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rental_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rental_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_likes_rental_id_user_id_key" UNIQUE("rental_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "rental_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rental_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rental_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rental_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rental_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rental_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rental_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"price_per_day" numeric(10, 2) NOT NULL,
	"min_days" integer DEFAULT 1 NOT NULL,
	"availability" text DEFAULT 'now' NOT NULL,
	"available_from" date,
	"location" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	CONSTRAINT "rental_listings_availability_check" CHECK (availability = ANY (ARRAY['now'::text, 'from_date'::text])),
	CONSTRAINT "rental_listings_category_check" CHECK (category = ANY (ARRAY['vehicles'::text, 'heavy'::text, 'light'::text, 'tools'::text, 'space'::text])),
	CONSTRAINT "rental_listings_currency_check" CHECK (currency = ANY (ARRAY['USD'::text, 'KHR'::text])),
	CONSTRAINT "rental_listings_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'rented'::text, 'inactive'::text]))
);
--> statement-breakpoint
ALTER TABLE "rental_listings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_status_check" CHECK (status = ANY (ARRAY['open'::text, 'resolved'::text, 'dismissed'::text])),
	CONSTRAINT "reports_target_kind_check" CHECK (target_kind = ANY (ARRAY['post'::text, 'listing'::text, 'profile'::text]))
);
--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "push_notification_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_token" text NOT NULL,
	"platform" text,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_notification_queue" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rental_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"location" text NOT NULL,
	"budget_per_day" numeric,
	"needed_from" date,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	CONSTRAINT "rental_requests_currency_check" CHECK (currency = ANY (ARRAY['USD'::text, 'KHR'::text]))
);
--> statement-breakpoint
ALTER TABLE "rental_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"media_url" text NOT NULL,
	"media_type" text DEFAULT 'photo' NOT NULL,
	"caption" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
	CONSTRAINT "stories_media_type_check" CHECK (media_type = ANY (ARRAY['photo'::text, 'video'::text])),
	CONSTRAINT "stories_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
	CONSTRAINT "stories_media_url_size_chk" CHECK (octet_length(media_url) <= 2621440)) NOT VALID)
);
--> statement-breakpoint
ALTER TABLE "stories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "streak_tracker" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"current_streak" integer DEFAULT 0 NOT NULL,
	"longest_streak" integer DEFAULT 0 NOT NULL,
	"last_check_date" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "streak_tracker" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "prize_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draw_id" uuid NOT NULL,
	"winner_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prize_claims_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'claimed'::text, 'expired'::text]))
);
--> statement-breakpoint
ALTER TABLE "prize_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone" text,
	"full_name" text,
	"avatar_url" text,
	"about_me" text,
	"is_provider" boolean DEFAULT false NOT NULL,
	"is_coordinator" boolean DEFAULT false NOT NULL,
	"is_organization" boolean DEFAULT false NOT NULL,
	"is_client" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"language" text DEFAULT 'km' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_recruiter" boolean DEFAULT false NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_specialist" boolean DEFAULT false NOT NULL,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"member_number" bigint,
	"is_super_user" boolean DEFAULT false NOT NULL,
	"master_account_id" uuid,
	CONSTRAINT "profiles_member_number_key" UNIQUE("member_number"),
	CONSTRAINT "profiles_avatar_url_size_chk" CHECK ((avatar_url IS NULL) OR (octet_length(avatar_url) <= 2621440))) NOT VALID)
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_store_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_store_categories_store_id_category_id_key" UNIQUE("category_id","store_id")
);
--> statement-breakpoint
ALTER TABLE "supplier_store_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_catalog_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	"name_en" text NOT NULL,
	"name_km" text,
	"unit" text DEFAULT 'unit' NOT NULL,
	"price" numeric(12, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"in_stock" boolean DEFAULT true NOT NULL,
	"photo_url" text,
	"note" text,
	"source" text DEFAULT 'list' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stock_status" text DEFAULT 'in_stock' NOT NULL,
	"offer_active" boolean DEFAULT false NOT NULL,
	"offer_price" numeric,
	"stock_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_km" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_categories_code_key" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "supplier_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_categories_user_id_category_id_key" UNIQUE("category_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "user_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppressed_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressed_emails_email_key" UNIQUE("email"),
	CONSTRAINT "suppressed_emails_reason_check" CHECK (reason = ANY (ARRAY['unsubscribe'::text, 'bounce'::text, 'complaint'::text]))
);
--> statement-breakpoint
ALTER TABLE "suppressed_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "telegram_password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"phone_digits" text NOT NULL,
	"start_token_hash" text NOT NULL,
	"code_hash" text,
	"telegram_chat_id" bigint,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_password_resets_start_token_hash_key" UNIQUE("start_token_hash")
);
--> statement-breakpoint
ALTER TABLE "telegram_password_resets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"categories" text[] DEFAULT '{""}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_settings_supplier_id_key" UNIQUE("supplier_id"),
	CONSTRAINT "supplier_settings_min_quantity_check" CHECK (min_quantity >= 1)
);
--> statement-breakpoint
ALTER TABLE "supplier_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "super_user_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_user_id" uuid NOT NULL,
	"identity_user_id" uuid NOT NULL,
	"display_order" integer DEFAULT 100 NOT NULL,
	"avatar_shape" text DEFAULT 'circle' NOT NULL,
	"is_official" boolean DEFAULT false NOT NULL,
	"badges" text[] DEFAULT '{""}' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "super_user_identities_master_user_id_identity_user_id_key" UNIQUE("identity_user_id","master_user_id")
);
--> statement-breakpoint
ALTER TABLE "super_user_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_invites_token_key" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "supplier_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_store_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_store_photos_photo_url_size_chk" CHECK (octet_length(photo_url) <= 2621440)) NOT VALID)
);
--> statement-breakpoint
ALTER TABLE "supplier_store_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"category_id" uuid NOT NULL,
	"title" text NOT NULL,
	"excerpt" text,
	"content" text NOT NULL,
	"cover_image_url" text,
	"author_name" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"meta_title" text,
	"meta_description" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "blog_posts_slug_key" UNIQUE("slug"),
	CONSTRAINT "blog_posts_status_check" CHECK (status = ANY (ARRAY['draft'::text, 'published'::text]))
);
--> statement-breakpoint
ALTER TABLE "blog_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_item_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_km" text NOT NULL,
	"unit" text DEFAULT 'unit' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"market_price_min" numeric,
	"market_price_max" numeric,
	"market_currency" text DEFAULT 'USD' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "catalog_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "listing_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "listing_categories_listing_id_category_id_key" UNIQUE("category_id","listing_id")
);
--> statement-breakpoint
ALTER TABLE "listing_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rental_comment_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_comment_likes_comment_id_user_id_key" UNIQUE("comment_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "rental_comment_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier_stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"description" text,
	"logo_url" text,
	"phone" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"contact_count" integer DEFAULT 0 NOT NULL,
	"fast_response" boolean DEFAULT false NOT NULL,
	"delivery_available" boolean DEFAULT false NOT NULL,
	"min_order" numeric,
	CONSTRAINT "supplier_stores_logo_url_size_chk" CHECK ((logo_url IS NULL) OR (octet_length(logo_url) <= 2621440))) NOT VALID)
);
--> statement-breakpoint
ALTER TABLE "supplier_stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "post_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reaction" text DEFAULT 'like' NOT NULL,
	CONSTRAINT "post_likes_post_id_user_id_key" UNIQUE("post_id","user_id"),
	CONSTRAINT "post_likes_reaction_check" CHECK (reaction = ANY (ARRAY['like'::text, 'love'::text, 'haha'::text, 'wow'::text, 'sad'::text]))
);
--> statement-breakpoint
ALTER TABLE "post_likes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_followers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_followers_store_id_user_id_key" UNIQUE("store_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "store_followers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketplace_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price" numeric,
	"currency" text DEFAULT 'USD' NOT NULL,
	"location" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketplace_items_kind_check" CHECK (kind = ANY (ARRAY['retail'::text, 'secondhand'::text])),
	CONSTRAINT "marketplace_items_status_check" CHECK (status = ANY (ARRAY['active'::text, 'sold'::text, 'closed'::text]))
);
--> statement-breakpoint
ALTER TABLE "marketplace_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "marketplace_item_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"photo_url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketplace_item_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_notifications" ADD CONSTRAINT "catalog_stock_notifications_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."supplier_catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_notifications" ADD CONSTRAINT "catalog_stock_notifications_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."supplier_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_notifications" ADD CONSTRAINT "catalog_stock_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_likes" ADD CONSTRAINT "comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."post_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_reports" ADD CONSTRAINT "catalog_stock_reports_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."supplier_catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_stock_reports" ADD CONSTRAINT "catalog_stock_reports_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."supplier_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_participant_a_fkey" FOREIGN KEY ("participant_a") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_participant_b_fkey" FOREIGN KEY ("participant_b") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_threads" ADD CONSTRAINT "message_threads_pinned_post_id_fkey" FOREIGN KEY ("pinned_post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_photos" ADD CONSTRAINT "portfolio_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."post_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_photos" ADD CONSTRAINT "material_request_photos_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."material_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_listing_id_fkey" FOREIGN KEY ("related_listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_project_id_fkey" FOREIGN KEY ("related_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_related_user_id_fkey" FOREIGN KEY ("related_user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_photos" ADD CONSTRAINT "post_photos_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_request_responses" ADD CONSTRAINT "material_request_responses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "public"."material_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lottery_draws" ADD CONSTRAINT "lottery_draws_winning_ticket_id_fkey" FOREIGN KEY ("winning_ticket_id") REFERENCES "public"."lottery_tickets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_codes" ADD CONSTRAINT "password_reset_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_messages" ADD CONSTRAINT "project_messages_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_logs" ADD CONSTRAINT "project_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_ratings" ADD CONSTRAINT "project_ratings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_views" ADD CONSTRAINT "story_views_viewer_id_fkey" FOREIGN KEY ("viewer_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_likes" ADD CONSTRAINT "rental_likes_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "public"."rental_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_photos" ADD CONSTRAINT "rental_photos_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."rental_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_comments" ADD CONSTRAINT "rental_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."rental_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_comments" ADD CONSTRAINT "rental_comments_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "public"."rental_listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_comments" ADD CONSTRAINT "rental_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_listings" ADD CONSTRAINT "rental_listings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prize_claims" ADD CONSTRAINT "prize_claims_draw_id_fkey" FOREIGN KEY ("draw_id") REFERENCES "public"."lottery_draws"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_master_account_id_fkey" FOREIGN KEY ("master_account_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_store_categories" ADD CONSTRAINT "supplier_store_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."supplier_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_store_categories" ADD CONSTRAINT "supplier_store_categories_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."supplier_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."supplier_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."catalog_products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_catalog_items" ADD CONSTRAINT "supplier_catalog_items_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."supplier_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_categories" ADD CONSTRAINT "user_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_categories" ADD CONSTRAINT "user_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "super_user_identities" ADD CONSTRAINT "super_user_identities_identity_user_id_fkey" FOREIGN KEY ("identity_user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "super_user_identities" ADD CONSTRAINT "super_user_identities_master_user_id_fkey" FOREIGN KEY ("master_user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_store_photos" ADD CONSTRAINT "supplier_store_photos_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."supplier_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."blog_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_events" ADD CONSTRAINT "catalog_item_events_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."supplier_catalog_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_item_events" ADD CONSTRAINT "catalog_item_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."supplier_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."supplier_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_categories" ADD CONSTRAINT "listing_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_categories" ADD CONSTRAINT "listing_categories_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_comment_likes" ADD CONSTRAINT "rental_comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."rental_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_followers" ADD CONSTRAINT "store_followers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "public"."supplier_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_items" ADD CONSTRAINT "marketplace_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_item_photos" ADD CONSTRAINT "marketplace_item_photos_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."marketplace_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_applications_applicant" ON "applications" USING btree ("applicant_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_applications_listing" ON "applications" USING btree ("listing_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "catalog_stock_notifications_item_idx" ON "catalog_stock_notifications" USING btree ("item_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_email_send_log_created" ON "email_send_log" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_email_send_log_message" ON "email_send_log" USING btree ("message_id" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "idx_email_send_log_message_sent_unique" ON "email_send_log" USING btree ("message_id" text_ops) WHERE (status = 'sent'::text);--> statement-breakpoint
CREATE INDEX "idx_email_send_log_recipient" ON "email_send_log" USING btree ("recipient_email" text_ops);--> statement-breakpoint
CREATE INDEX "idx_comment_likes_comment" ON "comment_likes" USING btree ("comment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_unsubscribe_tokens_token" ON "email_unsubscribe_tokens" USING btree ("token" text_ops);--> statement-breakpoint
CREATE INDEX "idx_invite_clicks_created" ON "invite_clicks" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_invite_clicks_inviter" ON "invite_clicks" USING btree ("inviter_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_invite_joins_created" ON "invite_joins" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_invite_joins_inviter" ON "invite_joins" USING btree ("inviter_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_listing_photos_listing" ON "listing_photos" USING btree ("listing_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "daily_availability_user_date_uniq" ON "daily_availability" USING btree ("user_id" date_ops,"date" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_catalog_search_events_recent" ON "catalog_search_events" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_stock_reports_unique_per_day" ON "catalog_stock_reports" USING btree ("item_id" date_ops,"user_id" date_ops,"report_day" date_ops);--> statement-breakpoint
CREATE INDEX "idx_message_threads_a" ON "message_threads" USING btree ("participant_a" uuid_ops,"last_message_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_message_threads_b" ON "message_threads" USING btree ("participant_b" uuid_ops,"last_message_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_message_threads_participant_a" ON "message_threads" USING btree ("participant_a" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_message_threads_participant_b" ON "message_threads" USING btree ("participant_b" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_portfolio_photos_user" ON "portfolio_photos" USING btree ("user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_post_comments_post" ON "post_comments" USING btree ("post_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "post_comments_parent_id_idx" ON "post_comments" USING btree ("parent_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "post_comments_post_id_idx" ON "post_comments" USING btree ("post_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "material_requests_active_cat_idx" ON "material_requests" USING btree ("category" text_ops,"status" text_ops) WHERE (status = 'active'::text);--> statement-breakpoint
CREATE INDEX "material_requests_user_idx" ON "material_requests" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "material_request_photos_req_idx" ON "material_request_photos" USING btree ("request_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_notifications_user_unread" ON "notifications" USING btree ("user_id" uuid_ops) WHERE (read_at IS NULL);--> statement-breakpoint
CREATE INDEX "notifications_related_post_id_idx" ON "notifications" USING btree ("related_post_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_post_photos_post" ON "post_photos" USING btree ("post_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "material_request_responses_req_idx" ON "material_request_responses" USING btree ("request_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "material_request_responses_supplier_idx" ON "material_request_responses" USING btree ("supplier_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_posts_category" ON "posts" USING btree ("category" text_ops) WHERE (category IS NOT NULL);--> statement-breakpoint
CREATE INDEX "idx_posts_status_created" ON "posts" USING btree ("status" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_posts_user" ON "posts" USING btree ("user_id" uuid_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_listings_status_created" ON "listings" USING btree ("status" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_listings_user" ON "listings" USING btree ("user_id" uuid_ops,"created_at" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_lottery_tickets_period" ON "lottery_tickets" USING btree ("ticket_type" date_ops,"draw_period_start" date_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_lottery_tickets_user" ON "lottery_tickets" USING btree ("user_id" text_ops,"status" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "lottery_tickets_daily_number_uniq" ON "lottery_tickets" USING btree ("draw_period_start" int4_ops,"ticket_number" date_ops) WHERE ((ticket_type = 'daily'::text) AND (ticket_number IS NOT NULL));--> statement-breakpoint
CREATE INDEX "idx_messages_unread" ON "messages" USING btree ("thread_id" uuid_ops,"sender_id" uuid_ops) WHERE (read_at IS NULL);--> statement-breakpoint
CREATE INDEX "messages_thread_id_created_at_idx" ON "messages" USING btree ("thread_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "password_reset_codes_user_idx" ON "password_reset_codes" USING btree ("user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_project_messages_project" ON "project_messages" USING btree ("project_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_project_logs_project" ON "project_logs" USING btree ("project_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_project_ratings_rated" ON "project_ratings" USING btree ("rated_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_projects_owner" ON "projects" USING btree ("owner_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_projects_worker" ON "projects" USING btree ("worker_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_story_views_story" ON "story_views" USING btree ("story_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_likes_rental" ON "rental_likes" USING btree ("rental_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_photos_listing" ON "rental_photos" USING btree ("listing_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_comments_parent" ON "rental_comments" USING btree ("parent_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_comments_rental" ON "rental_comments" USING btree ("rental_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_listings_category" ON "rental_listings" USING btree ("category" text_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_listings_status" ON "rental_listings" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_listings_status_created" ON "rental_listings" USING btree ("status" text_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_listings_user" ON "rental_listings" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_reports_status" ON "reports" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_reports_target" ON "reports" USING btree ("target_kind" text_ops,"target_id" text_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_requests_status_created" ON "rental_requests" USING btree ("status" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_requests_user" ON "rental_requests" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_stories_active_created" ON "stories" USING btree ("created_at" timestamptz_ops) WHERE (status = 'active'::text);--> statement-breakpoint
CREATE INDEX "stories_active_idx" ON "stories" USING btree ("expires_at" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "stories_user_idx" ON "stories" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_prize_claims_winner" ON "prize_claims" USING btree ("winner_id" text_ops,"status" text_ops);--> statement-breakpoint
CREATE INDEX "idx_profiles_master_account" ON "profiles" USING btree ("master_account_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_supplier_catalog_items_store" ON "supplier_catalog_items" USING btree ("store_id" uuid_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_catalog_items_store_product_key" ON "supplier_catalog_items" USING btree ("store_id" uuid_ops,"product_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_suppressed_emails_email" ON "suppressed_emails" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "telegram_password_resets_phone_created_idx" ON "telegram_password_resets" USING btree ("phone_digits" text_ops,"created_at" text_ops);--> statement-breakpoint
CREATE INDEX "telegram_password_resets_user_created_idx" ON "telegram_password_resets" USING btree ("user_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_catalog_item_events_item" ON "catalog_item_events" USING btree ("item_id" text_ops,"event_type" text_ops);--> statement-breakpoint
CREATE INDEX "idx_catalog_item_events_store" ON "catalog_item_events" USING btree ("store_id" timestamptz_ops,"created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "idx_catalog_products_category" ON "catalog_products" USING btree ("category_id" int4_ops,"sort_order" int4_ops);--> statement-breakpoint
CREATE INDEX "idx_listing_categories_listing" ON "listing_categories" USING btree ("listing_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_rental_comment_likes_comment" ON "rental_comment_likes" USING btree ("comment_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "supplier_stores_user_id_idx" ON "supplier_stores" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "idx_post_likes_post" ON "post_likes" USING btree ("post_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "store_followers_user_idx" ON "store_followers" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE VIEW "public"."app_settings_public" WITH (security_invoker = on) AS (SELECT id, telegram_chat_id, telegram_webhook_url, updated_at FROM app_settings);--> statement-breakpoint
CREATE POLICY "applicants and owners read applications" ON "applications" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth.uid() = applicant_id) OR (EXISTS ( SELECT 1
   FROM listings l
  WHERE ((l.id = applications.listing_id) AND (l.user_id = auth.uid()))))));--> statement-breakpoint
CREATE POLICY "owners update applications" ON "applications" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own applications" ON "applications" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "blog_categories public read" ON "blog_categories" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "Admins can insert settings" ON "app_settings" AS PERMISSIVE FOR INSERT TO public WITH CHECK (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "Admins can update settings" ON "app_settings" AS PERMISSIVE FOR UPDATE TO public;--> statement-breakpoint
CREATE POLICY "Admins can view settings" ON "app_settings" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "Store owners can view alerts on their items" ON "catalog_stock_notifications" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM supplier_stores s
  WHERE ((s.id = catalog_stock_notifications.store_id) AND (s.user_id = auth.uid())))));--> statement-breakpoint
CREATE POLICY "Users manage their own stock alerts" ON "catalog_stock_notifications" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "Service role can insert send log" ON "email_send_log" AS PERMISSIVE FOR INSERT TO "service_role" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "Service role can read send log" ON "email_send_log" AS PERMISSIVE FOR SELECT TO "service_role";--> statement-breakpoint
CREATE POLICY "Service role can update send log" ON "email_send_log" AS PERMISSIVE FOR UPDATE TO "service_role";--> statement-breakpoint
CREATE POLICY "deny_non_service_role" ON "email_send_log" AS RESTRICTIVE FOR ALL TO "anon", "authenticated";--> statement-breakpoint
CREATE POLICY "Users can delete own device tokens" ON "device_tokens" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "Users can insert own device tokens" ON "device_tokens" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Users can update own device tokens" ON "device_tokens" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Users can view own device tokens" ON "device_tokens" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users delete own device tokens" ON "device_tokens" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own device tokens" ON "device_tokens" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users select own device tokens" ON "device_tokens" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users update own device tokens" ON "device_tokens" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "comment_likes readable by auth" ON "comment_likes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth.uid() = user_id) OR is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM (post_comments c
     JOIN posts p ON ((p.id = c.post_id)))
  WHERE ((c.id = comment_likes.comment_id) AND ((p.status = 'approved'::text) OR (p.user_id = auth.uid())))))));--> statement-breakpoint
CREATE POLICY "users delete own comment_likes" ON "comment_likes" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own comment_likes" ON "comment_likes" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Service role can manage send state" ON "email_send_state" AS PERMISSIVE FOR ALL TO "service_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "deny_non_service_role" ON "email_send_state" AS RESTRICTIVE FOR ALL TO "anon", "authenticated";--> statement-breakpoint
CREATE POLICY "Service role can insert tokens" ON "email_unsubscribe_tokens" AS PERMISSIVE FOR INSERT TO "service_role" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "Service role can mark tokens as used" ON "email_unsubscribe_tokens" AS PERMISSIVE FOR UPDATE TO "service_role";--> statement-breakpoint
CREATE POLICY "Service role can read tokens" ON "email_unsubscribe_tokens" AS PERMISSIVE FOR SELECT TO "service_role";--> statement-breakpoint
CREATE POLICY "deny_non_service_role" ON "email_unsubscribe_tokens" AS RESTRICTIVE FOR ALL TO "anon", "authenticated";--> statement-breakpoint
CREATE POLICY "inviter reads own clicks" ON "invite_clicks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth.uid() = inviter_id) OR is_admin(auth.uid())));--> statement-breakpoint
CREATE POLICY "users insert own invite_code" ON "invite_codes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "users read own invite_code" ON "invite_codes" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "no client inserts on invite_joins" ON "invite_joins" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "users read own invite_joins" ON "invite_joins" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins insert rewards" ON "invite_rewards" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "admins update rewards" ON "invite_rewards" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users read own rewards" ON "invite_rewards" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "listing_photos readable" ON "listing_photos" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM listings l
  WHERE ((l.id = listing_photos.listing_id) AND ((l.status = ANY (ARRAY['active'::text, 'approved'::text])) OR (l.user_id = auth.uid()) OR is_admin(auth.uid()))))));--> statement-breakpoint
CREATE POLICY "owners manage listing_photos" ON "listing_photos" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "Users delete own availability" ON "daily_availability" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "Users update own availability" ON "daily_availability" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins read all availability" ON "daily_availability" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own availability" ON "daily_availability" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users read own availability" ON "daily_availability" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "anyone can record catalogue searches" ON "catalog_search_events" AS PERMISSIVE FOR INSERT TO "anon", "authenticated" WITH CHECK (((char_length(term) >= 1) AND (char_length(term) <= 120)));--> statement-breakpoint
CREATE POLICY "Admins can read stock reports" ON "catalog_stock_reports" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "Users can report a product" ON "catalog_stock_reports" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "categories readable by everyone" ON "categories" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "participants read threads" ON "message_threads" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth.uid() = participant_a) OR (auth.uid() = participant_b)));--> statement-breakpoint
CREATE POLICY "participants update threads" ON "message_threads" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "super user reads group threads" ON "message_threads" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users create threads they are part of" ON "message_threads" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "portfolio readable by auth" ON "portfolio_photos" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "users manage own portfolio" ON "portfolio_photos" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "comments readable by auth" ON "post_comments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth.uid() = user_id) OR is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = post_comments.post_id) AND ((p.status = 'approved'::text) OR (p.user_id = auth.uid())))))));--> statement-breakpoint
CREATE POLICY "users delete own comments" ON "post_comments" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own comments" ON "post_comments" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users update own post_comments" ON "post_comments" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "owner inserts own request" ON "material_requests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "owner reads own requests" ON "material_requests" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "owner updates own request" ON "material_requests" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "supplier reads matching active requests" ON "material_requests" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "owner deletes photos" ON "material_request_photos" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM material_requests r
  WHERE ((r.id = material_request_photos.request_id) AND (r.user_id = auth.uid())))));--> statement-breakpoint
CREATE POLICY "owner inserts photos" ON "material_request_photos" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "photos readable when parent readable" ON "material_request_photos" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users delete own notifications" ON "notifications" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "users read own notifications" ON "notifications" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users update own notifications" ON "notifications" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "owners manage post_photos" ON "post_photos" AS PERMISSIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = post_photos.post_id) AND (p.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = post_photos.post_id) AND (p.user_id = auth.uid())))));--> statement-breakpoint
CREATE POLICY "post_photos readable" ON "post_photos" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "owner reads available responses on own request" ON "material_request_responses" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((response = 'available'::text) AND (EXISTS ( SELECT 1
   FROM material_requests r
  WHERE ((r.id = material_request_responses.request_id) AND (r.user_id = auth.uid()))))));--> statement-breakpoint
CREATE POLICY "supplier inserts own response" ON "material_request_responses" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "supplier reads own responses" ON "material_request_responses" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins delete posts" ON "posts" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "admins manage all posts update" ON "posts" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins read all posts" ON "posts" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "approved posts readable by auth" ON "posts" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users delete own posts" ON "posts" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own posts" ON "posts" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users update own posts" ON "posts" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Admins can delete any listing" ON "listings" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "Admins can update any listing" ON "listings" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Admins can view all listings" ON "listings" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "active or own listings readable" ON "listings" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins delete listings" ON "listings" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins update listings" ON "listings" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users delete own listings" ON "listings" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own listings" ON "listings" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users update own listings" ON "listings" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins manage draws" ON "lottery_draws" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "auth read safe published or own draws" ON "lottery_draws" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins manage tickets" ON "lottery_tickets" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "admins read all tickets" ON "lottery_tickets" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users read own tickets" ON "lottery_tickets" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "recipients mark read" ON "messages" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM message_threads t
  WHERE ((t.id = messages.thread_id) AND ((auth.uid() = t.participant_a) OR (auth.uid() = t.participant_b)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM message_threads t
  WHERE ((t.id = messages.thread_id) AND ((auth.uid() = t.participant_a) OR (auth.uid() = t.participant_b))))));--> statement-breakpoint
CREATE POLICY "super user reads group messages" ON "messages" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "thread participants insert messages" ON "messages" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "thread participants read messages" ON "messages" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Deny anon and authenticated on password_reset_codes" ON "password_reset_codes" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "Service role only access" ON "password_reset_codes" AS PERMISSIVE FOR ALL TO "service_role";--> statement-breakpoint
CREATE POLICY "participants insert project messages" ON "project_messages" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((auth.uid() = sender_id) AND is_project_participant(project_id, auth.uid())));--> statement-breakpoint
CREATE POLICY "participants read project messages" ON "project_messages" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "participants insert logs" ON "project_logs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((auth.uid() = user_id) AND is_project_participant(project_id, auth.uid())));--> statement-breakpoint
CREATE POLICY "participants read logs" ON "project_logs" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "participants insert rating" ON "project_ratings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (((auth.uid() = rater_id) AND is_project_participant(project_id, auth.uid()) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_ratings.project_id) AND (p.status = 'completed'::text))))));--> statement-breakpoint
CREATE POLICY "ratings participants read" ON "project_ratings" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "owner inserts project" ON "projects" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((auth.uid() = owner_id));--> statement-breakpoint
CREATE POLICY "participants read project" ON "projects" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "participants update project" ON "projects" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "story owner reads views" ON "story_views" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth.uid() = viewer_id) OR (EXISTS ( SELECT 1
   FROM stories s
  WHERE ((s.id = story_views.story_id) AND (s.user_id = auth.uid()))))));--> statement-breakpoint
CREATE POLICY "viewers insert own view" ON "story_views" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users delete own rental_likes" ON "rental_likes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "rental_likes readable by auth" ON "rental_likes" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own rental_likes" ON "rental_likes" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Anyone can view rental photos for approved listings" ON "rental_photos" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM rental_listings rl
  WHERE ((rl.id = rental_photos.listing_id) AND ((rl.status = 'approved'::text) OR (rl.user_id = auth.uid()) OR is_admin(auth.uid()))))));--> statement-breakpoint
CREATE POLICY "Owner can delete rental photos" ON "rental_photos" AS PERMISSIVE FOR DELETE TO public;--> statement-breakpoint
CREATE POLICY "Owner can insert rental photos" ON "rental_photos" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "users delete own rental_comments" ON "rental_comments" AS PERMISSIVE FOR DELETE TO "authenticated" USING (((auth.uid() = user_id) OR is_admin(auth.uid())));--> statement-breakpoint
CREATE POLICY "rental_comments readable by auth" ON "rental_comments" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own rental_comments" ON "rental_comments" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users update own rental_comments" ON "rental_comments" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Anyone can view approved rentals" ON "rental_listings" AS PERMISSIVE FOR SELECT TO public USING (((status = 'approved'::text) OR (auth.uid() = user_id) OR is_admin(auth.uid())));--> statement-breakpoint
CREATE POLICY "Users can delete their own rentals" ON "rental_listings" AS PERMISSIVE FOR DELETE TO public;--> statement-breakpoint
CREATE POLICY "Users can insert their own rentals" ON "rental_listings" AS PERMISSIVE FOR INSERT TO public;--> statement-breakpoint
CREATE POLICY "Users can update their own rentals" ON "rental_listings" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins delete reports" ON "reports" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "admins read all reports" ON "reports" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins update reports" ON "reports" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own reports" ON "reports" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users read own reports" ON "reports" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Authenticated users can insert their own push jobs" ON "push_notification_queue" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "Service role can manage push queue" ON "push_notification_queue" AS PERMISSIVE FOR ALL TO "service_role";--> statement-breakpoint
CREATE POLICY "approved rental_requests readable by auth" ON "rental_requests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((status = 'approved'::text) OR (auth.uid() = user_id) OR is_admin(auth.uid())));--> statement-breakpoint
CREATE POLICY "users delete own rental_requests" ON "rental_requests" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own rental_requests" ON "rental_requests" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users update own rental_requests" ON "rental_requests" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins delete stories" ON "stories" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "admins update stories" ON "stories" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "approved active stories readable by auth" ON "stories" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own stories" ON "stories" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users update own stories" ON "stories" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins manage streak" ON "streak_tracker" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "users read own streak" ON "streak_tracker" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins manage claims" ON "prize_claims" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "winner reads own claim" ON "prize_claims" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "profiles are viewable by authenticated" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "super user reads linked profiles" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own profile" ON "profiles" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "users update own profile" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "public profiles readable by visitors" ON "profiles" AS PERMISSIVE FOR SELECT TO "anon";--> statement-breakpoint
CREATE POLICY "owner manages store_cats" ON "supplier_store_categories" AS PERMISSIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM supplier_stores s
  WHERE ((s.id = supplier_store_categories.store_id) AND (s.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM supplier_stores s
  WHERE ((s.id = supplier_store_categories.store_id) AND (s.user_id = auth.uid())))));--> statement-breakpoint
CREATE POLICY "store_cats readable" ON "supplier_store_categories" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "admins view all catalog items" ON "supplier_catalog_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "approved store catalog items are viewable" ON "supplier_catalog_items" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "owners manage own catalog items" ON "supplier_catalog_items" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "supplier_categories readable by everyone" ON "supplier_categories" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "users manage own categories" ON "user_categories" AS PERMISSIVE FOR ALL TO "authenticated" USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "users read own categories" ON "user_categories" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Service role can insert suppressed emails" ON "suppressed_emails" AS PERMISSIVE FOR INSERT TO "service_role" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "Service role can read suppressed emails" ON "suppressed_emails" AS PERMISSIVE FOR SELECT TO "service_role";--> statement-breakpoint
CREATE POLICY "deny authenticated all" ON "suppressed_emails" AS RESTRICTIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "deny authenticated read" ON "suppressed_emails" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "deny anon all" ON "suppressed_emails" AS RESTRICTIVE FOR ALL TO "anon";--> statement-breakpoint
CREATE POLICY "deny anon read" ON "suppressed_emails" AS RESTRICTIVE FOR ALL TO "anon";--> statement-breakpoint
CREATE POLICY "Deny anon and authenticated on telegram_password_resets" ON "telegram_password_resets" AS RESTRICTIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "Service role manages Telegram password resets" ON "telegram_password_resets" AS PERMISSIVE FOR ALL TO "service_role";--> statement-breakpoint
CREATE POLICY "supplier reads own settings" ON "supplier_settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((auth.uid() = supplier_id));--> statement-breakpoint
CREATE POLICY "supplier updates own settings" ON "supplier_settings" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "supplier upserts own settings" ON "supplier_settings" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "master reads own identities" ON "super_user_identities" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((master_user_id = current_master_user_id()));--> statement-breakpoint
CREATE POLICY "admins manage supplier invites" ON "supplier_invites" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "deny non-admin authenticated read" ON "supplier_invites" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "owner manages store_photos" ON "supplier_store_photos" AS PERMISSIVE FOR ALL TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM supplier_stores s
  WHERE ((s.id = supplier_store_photos.store_id) AND (s.user_id = auth.uid()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM supplier_stores s
  WHERE ((s.id = supplier_store_photos.store_id) AND (s.user_id = auth.uid())))));--> statement-breakpoint
CREATE POLICY "store_photos readable" ON "supplier_store_photos" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "blog_published_posts public read" ON "blog_posts" AS PERMISSIVE FOR SELECT TO "anon", "authenticated" USING ((status = 'published'::text));--> statement-breakpoint
CREATE POLICY "anyone can record catalogue activity" ON "catalog_item_events" AS PERMISSIVE FOR INSERT TO "anon", "authenticated" WITH CHECK ((event_type = ANY (ARRAY['view'::text, 'chat'::text, 'request'::text])));--> statement-breakpoint
CREATE POLICY "store owners read their catalogue activity" ON "catalog_item_events" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins manage catalog products" ON "catalog_products" AS PERMISSIVE FOR ALL TO "authenticated" USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "catalog products are public" ON "catalog_products" AS PERMISSIVE FOR SELECT TO public;--> statement-breakpoint
CREATE POLICY "listing_cats readable by auth" ON "listing_categories" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM listings l
  WHERE ((l.id = listing_categories.listing_id) AND ((l.status = ANY (ARRAY['active'::text, 'approved'::text])) OR (l.user_id = auth.uid()) OR is_admin(auth.uid()))))));--> statement-breakpoint
CREATE POLICY "owners manage listing_cats" ON "listing_categories" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "rental_comment_likes readable by auth" ON "rental_comment_likes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth.uid() = user_id) OR is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM (rental_comments c
     JOIN rental_listings r ON ((r.id = c.rental_id)))
  WHERE ((c.id = rental_comment_likes.comment_id) AND ((r.status = 'approved'::text) OR (r.user_id = auth.uid())))))));--> statement-breakpoint
CREATE POLICY "users delete own rental_comment_likes" ON "rental_comment_likes" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own rental_comment_likes" ON "rental_comment_likes" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "admins delete supplier stores" ON "supplier_stores" AS PERMISSIVE FOR DELETE TO "authenticated" USING (is_admin(auth.uid()));--> statement-breakpoint
CREATE POLICY "admins manage stores" ON "supplier_stores" AS PERMISSIVE FOR ALL TO "authenticated";--> statement-breakpoint
CREATE POLICY "approved or own supplier_stores readable" ON "supplier_stores" AS PERMISSIVE FOR SELECT TO "authenticated";--> statement-breakpoint
CREATE POLICY "owner deletes own store" ON "supplier_stores" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "owner inserts own store" ON "supplier_stores" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "owner updates own store" ON "supplier_stores" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "likes readable by auth" ON "post_likes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((auth.uid() = user_id) OR is_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM posts p
  WHERE ((p.id = post_likes.post_id) AND ((p.status = 'approved'::text) OR (p.user_id = auth.uid())))))));--> statement-breakpoint
CREATE POLICY "users delete own likes" ON "post_likes" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "users insert own likes" ON "post_likes" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Users can update own reaction" ON "post_likes" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Users see own follows" ON "store_followers" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((auth.uid() = user_id));--> statement-breakpoint
CREATE POLICY "Users follow others' stores" ON "store_followers" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Users unfollow" ON "store_followers" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Anyone can view active marketplace items" ON "marketplace_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (((status = 'active'::text) OR (user_id = auth.uid())));--> statement-breakpoint
CREATE POLICY "Users can create their own marketplace items" ON "marketplace_items" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Owners can update their marketplace items" ON "marketplace_items" AS PERMISSIVE FOR UPDATE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Owners can delete their marketplace items" ON "marketplace_items" AS PERMISSIVE FOR DELETE TO "authenticated";--> statement-breakpoint
CREATE POLICY "Anyone can view marketplace item photos" ON "marketplace_item_photos" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "Owners can add photos to their items" ON "marketplace_item_photos" AS PERMISSIVE FOR INSERT TO "authenticated";--> statement-breakpoint
CREATE POLICY "Owners can delete photos from their items" ON "marketplace_item_photos" AS PERMISSIVE FOR DELETE TO "authenticated";
*/