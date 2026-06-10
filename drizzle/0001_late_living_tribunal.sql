CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX "charts_dashboard_idx";--> statement-breakpoint
DROP INDEX "dashboards_product_idx";--> statement-breakpoint
DROP INDEX "memberships_org_user_uq";--> statement-breakpoint
DROP INDEX "memberships_user_idx";--> statement-breakpoint
DROP INDEX "organizations_slug_unique";--> statement-breakpoint
DROP INDEX "products_org_slug_uq";--> statement-breakpoint
DROP INDEX "products_org_idx";--> statement-breakpoint
DROP INDEX "sessions_token_unique";--> statement-breakpoint
DROP INDEX "source_connections_product_idx";--> statement-breakpoint
DROP INDEX "source_connections_status_idx";--> statement-breakpoint
DROP INDEX "sync_runs_connection_idx";--> statement-breakpoint
DROP INDEX "users_email_unique";--> statement-breakpoint
ALTER TABLE `users` ALTER COLUMN "name" TO "name" text NOT NULL;--> statement-breakpoint
CREATE INDEX `charts_dashboard_idx` ON `charts` (`dashboard_id`);--> statement-breakpoint
CREATE INDEX `dashboards_product_idx` ON `dashboards` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_org_user_uq` ON `memberships` (`org_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `products_org_slug_uq` ON `products` (`org_id`,`slug`);--> statement-breakpoint
CREATE INDEX `products_org_idx` ON `products` (`org_id`);--> statement-breakpoint
CREATE INDEX `source_connections_product_idx` ON `source_connections` (`product_id`);--> statement-breakpoint
CREATE INDEX `source_connections_status_idx` ON `source_connections` (`status`,`provider`);--> statement-breakpoint
CREATE INDEX `sync_runs_connection_idx` ON `sync_runs` (`connection_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `users` ALTER COLUMN "created_at" TO "created_at" integer NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `image` text;--> statement-breakpoint
ALTER TABLE `users` ADD `updated_at` integer NOT NULL;