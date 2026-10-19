-- F16: three more kinds of notification (docs/DOMAIN_RULES.md, "Notifications").
ALTER TYPE "NotificationKind" ADD VALUE 'upload_quarantined';
ALTER TYPE "NotificationKind" ADD VALUE 'term_ending';
ALTER TYPE "NotificationKind" ADD VALUE 'announcement_posted';

-- Email on or off per kind. No row means email is on.
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "email" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","kind")
);

ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
