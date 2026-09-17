ALTER TABLE `cpe_catalog` ADD `requires_grounding` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `cpe_requires_grounding` integer DEFAULT false NOT NULL;--> statement-breakpoint
DELETE FROM `cpe_catalog`;
