CREATE TABLE IF NOT EXISTS `orange_mail_import` (
  `id` text PRIMARY KEY NOT NULL,
  `enabled` integer NOT NULL DEFAULT 0,
  `activated_at` integer NOT NULL DEFAULT 0,
  `last_run_at` integer NOT NULL DEFAULT 0,
  `last_error` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `orange_mail_messages` (
  `message_id` text PRIMARY KEY NOT NULL,
  `ticket_id` text NOT NULL,
  `received_at` text NOT NULL,
  `status` text NOT NULL,
  `error` text NOT NULL DEFAULT '',
  `processed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `orange_mail_messages_ticket_idx` ON `orange_mail_messages` (`ticket_id`);
--> statement-breakpoint
INSERT OR IGNORE INTO `orange_mail_import` (`id`, `enabled`, `activated_at`, `last_run_at`, `last_error`)
VALUES ('orange', 1, unixepoch('now') * 1000, 0, '');
