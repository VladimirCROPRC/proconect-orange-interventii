UPDATE `projects`
SET `activity_type` = 'Intervenție Orange'
WHERE `activity_type` <> 'Intervenție Orange';
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `projects_orange_only_insert`
BEFORE INSERT ON `projects`
WHEN NEW.`activity_type` <> 'Intervenție Orange'
BEGIN
  SELECT RAISE(ABORT, 'Această bază acceptă exclusiv intervenții Orange');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `projects_orange_only_update`
BEFORE UPDATE OF `activity_type` ON `projects`
WHEN NEW.`activity_type` <> 'Intervenție Orange'
BEGIN
  SELECT RAISE(ABORT, 'Această bază acceptă exclusiv intervenții Orange');
END;
