CREATE TABLE `cpe_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cpe_catalog_name_idx` ON `cpe_catalog` (`name`);--> statement-breakpoint
CREATE TABLE `project_field_documentation` (
	`project_id` text PRIMARY KEY NOT NULL,
	`content_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`section` text NOT NULL,
	`category` text NOT NULL,
	`original_name` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`geolocation` text DEFAULT '' NOT NULL,
	`captured_at` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_files_project_section_idx` ON `project_files` (`project_id`,`section`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_files_storage_key_idx` ON `project_files` (`storage_key`);--> statement-breakpoint
CREATE TABLE `project_reports` (
	`project_id` text PRIMARY KEY NOT NULL,
	`content_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`client` text NOT NULL,
	`address` text NOT NULL,
	`contact` text NOT NULL,
	`phone` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`requirements` text NOT NULL,
	`technician` text NOT NULL,
	`technician_username` text NOT NULL,
	`cpe` text NOT NULL,
	`sfp` integer DEFAULT false NOT NULL,
	`mc` integer DEFAULT false NOT NULL,
	`terminal_box` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`scheduled_label` text NOT NULL,
	`ipwo` text NOT NULL,
	`splice` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_technician_username_idx` ON `projects` (`technician_username`);