CREATE TABLE IF NOT EXISTS `orange_workbook_sync_state` (
  `project_id` text PRIMARY KEY NOT NULL,
  `values_json` text NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON UPDATE no action ON DELETE cascade
);
