ALTER TABLE "chatbot_conversations" ALTER COLUMN "status" SET DEFAULT 'OPEN';--> statement-breakpoint
ALTER TABLE "chatbot_conversations" ADD COLUMN "source" text DEFAULT 'chat_widget' NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_conversations" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "chatbot_conversations" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "chatbot_conversations" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "chatbot_messages" ADD COLUMN "attachment_key" text;--> statement-breakpoint
ALTER TABLE "chatbot_messages" ADD COLUMN "attachment_type" text;--> statement-breakpoint
UPDATE "chatbot_conversations" SET "status" = 'OPEN' WHERE "status" IN ('BOT', 'PENDING_HUMAN');
UPDATE "chatbot_conversations" SET "status" = 'IN_PROGRESS' WHERE "status" = 'HUMAN';
UPDATE "chatbot_conversations" SET "source" = 'chat_widget' WHERE "source" IS NULL;
