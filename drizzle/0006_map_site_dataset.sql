CREATE TABLE `map_site_dataset` (
  `id` text PRIMARY KEY NOT NULL,
  `source_name` text NOT NULL,
  `content_json` text NOT NULL,
  `site_count` integer NOT NULL,
  `rejected_count` integer DEFAULT 0 NOT NULL,
  `updated_by` text NOT NULL,
  `updated_at` integer NOT NULL
);
