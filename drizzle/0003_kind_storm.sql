ALTER TABLE "user" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'pharmacist' NOT NULL;