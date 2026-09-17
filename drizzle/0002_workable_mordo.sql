CREATE TABLE `google_drive_file_sync` (
	`file_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`drive_file_id` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `project_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `google_drive_file_sync_project_idx` ON `google_drive_file_sync` (`project_id`);--> statement-breakpoint
CREATE TABLE `google_drive_oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`encrypted_verifier` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `google_drive_project_folders` (
	`project_id` text PRIMARY KEY NOT NULL,
	`folder_id` text NOT NULL,
	`folder_url` text NOT NULL,
	`section_folders_json` text NOT NULL,
	`report_file_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `google_drive_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`encrypted_client_secret` text NOT NULL,
	`account_email` text DEFAULT '' NOT NULL,
	`encrypted_access_token` text DEFAULT '' NOT NULL,
	`encrypted_refresh_token` text DEFAULT '' NOT NULL,
	`access_token_expires_at` integer DEFAULT 0 NOT NULL,
	`root_folder_id` text DEFAULT '' NOT NULL,
	`root_folder_name` text DEFAULT 'Proconect B2B' NOT NULL,
	`connected_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
