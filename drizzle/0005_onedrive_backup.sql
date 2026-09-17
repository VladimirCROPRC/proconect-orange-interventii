CREATE TABLE `onedrive_connection` (
  `id` text PRIMARY KEY NOT NULL,
  `mode` text NOT NULL DEFAULT 'google',
  `generation` text NOT NULL DEFAULT '',
  `access_token` text NOT NULL DEFAULT '',
  `refresh_token` text NOT NULL DEFAULT '',
  `expires_at` integer NOT NULL DEFAULT 0,
  `drive_id` text NOT NULL DEFAULT '',
  `root_id` text NOT NULL DEFAULT '',
  `root_url` text NOT NULL DEFAULT '',
  `account` text NOT NULL DEFAULT '',
  `owner_id` text NOT NULL DEFAULT '',
  `lease` text NOT NULL DEFAULT '',
  `lease_until` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE `onedrive_oauth_states` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `verifier` text NOT NULL,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `onedrive_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `item_id` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 1,
  `done_revision` integer NOT NULL DEFAULT 0,
  `attempts` integer NOT NULL DEFAULT 0,
  `next_at` integer NOT NULL DEFAULT 0,
  `last_error` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX onedrive_jobs_pending_idx ON onedrive_jobs (next_at);

