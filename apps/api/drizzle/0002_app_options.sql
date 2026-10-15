ALTER TABLE "app_configs" ADD COLUMN "promo_text" text;--> statement-breakpoint
ALTER TABLE "app_configs" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "return_url" text;