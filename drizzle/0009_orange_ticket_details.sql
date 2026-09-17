ALTER TABLE `projects` ADD `fo_section_name` text DEFAULT '' NOT NULL;
ALTER TABLE `projects` ADD `topology` text DEFAULT '' NOT NULL;
ALTER TABLE `projects` ADD `cable_capacity` integer DEFAULT 0 NOT NULL;
ALTER TABLE `projects` ADD `route_type` text DEFAULT '' NOT NULL;
ALTER TABLE `projects` ADD `orange_intervention_type` text DEFAULT '' NOT NULL;
ALTER TABLE `projects` ADD `sla` text DEFAULT '' NOT NULL;
ALTER TABLE `projects` ADD `departure_locality` text DEFAULT '' NOT NULL;
