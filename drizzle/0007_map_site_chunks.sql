CREATE TABLE `map_site_dataset_chunks` (
  `generation` text NOT NULL,
  `chunk_index` integer NOT NULL,
  `content_json` text NOT NULL,
  PRIMARY KEY (`generation`, `chunk_index`)
);
--> statement-breakpoint
CREATE INDEX `map_site_dataset_chunks_generation_idx` ON `map_site_dataset_chunks` (`generation`);
