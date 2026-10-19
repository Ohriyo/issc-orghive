-- Officers publish, edit and delete updates (announcements); each change is audited.
ALTER TYPE "AuditAction" ADD VALUE 'announcement_change';

-- When an update was last edited after publishing; shown as "Edited".
ALTER TABLE "announcements" ADD COLUMN "edited_at" TIMESTAMP(3);
