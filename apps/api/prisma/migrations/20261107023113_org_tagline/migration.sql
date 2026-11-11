-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "tagline" TEXT;

-- PROFILE_TAGLINE_MAX (packages/shared/src/profile.ts); the API checks it first.
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tagline_length" CHECK (char_length("tagline") <= 160);
