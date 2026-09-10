ALTER TABLE "sample_videos" ADD COLUMN "duration" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
ALTER TABLE "sample_videos" ADD COLUMN "quality" text DEFAULT '720p' NOT NULL;--> statement-breakpoint
ALTER TABLE "sample_videos" ADD CONSTRAINT "sample_videos_duration_valid" CHECK ("sample_videos"."duration" BETWEEN 1 AND 15);--> statement-breakpoint
ALTER TABLE "sample_videos" ADD CONSTRAINT "sample_videos_quality_valid" CHECK ("sample_videos"."quality" IN ('360p', '540p', '720p', '1080p'));