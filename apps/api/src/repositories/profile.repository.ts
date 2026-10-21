import type { ProfileFields } from '@orghive/shared';
import type { Prisma } from '#src/generated/prisma/client';
import type { Db } from './prisma';

const profileSelect = {
  id: true,
  slug: true,
  type: true,
  acronym: true,
  name: true,
  description: true,
  mission: true,
  vision: true,
  contactEmail: true,
  facebookUrl: true,
  logoKey: true,
  coverKey: true,
  updatedAt: true,
  college: { select: { code: true, slug: true, name: true } },
  officers: {
    orderBy: { sortOrder: 'asc' },
    select: { position: true, name: true, isPublic: true },
  },
  links: { orderBy: { sortOrder: 'asc' }, select: { url: true } },
} satisfies Prisma.OrganizationSelect;

export type ProfileRecord = Prisma.OrganizationGetPayload<{ select: typeof profileSelect }>;

/** An organization's own profile (/dashboard/profile): every officer, hidden ones included. */
export function createProfileRepository(db: Db) {
  return {
    findById(organizationId: string): Promise<ProfileRecord | null> {
      return db.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
        select: profileSelect,
      });
    },

    /**
     * Replaces every editable field, the officers and the links in one transaction, so a
     * reader never sees half a save. Name, acronym, type and college are never touched.
     */
    save(organizationId: string, fields: ProfileFields): Promise<ProfileRecord> {
      return db.$transaction(async (tx) => {
        await tx.organizationOfficer.deleteMany({ where: { organizationId } });
        await tx.organizationLink.deleteMany({ where: { organizationId } });
        if (fields.officers.length > 0) {
          await tx.organizationOfficer.createMany({
            data: fields.officers.map((officer, sortOrder) => ({
              organizationId,
              ...officer,
              sortOrder,
            })),
          });
        }
        if (fields.links.length > 0) {
          await tx.organizationLink.createMany({
            data: fields.links.map((url, sortOrder) => ({ organizationId, url, sortOrder })),
          });
        }
        return tx.organization.update({
          where: { id: organizationId },
          data: {
            description: fields.description,
            mission: fields.mission,
            vision: fields.vision,
            contactEmail: fields.contactEmail,
            facebookUrl: fields.facebookUrl,
          },
          select: profileSelect,
        });
      });
    },

    setLogo(organizationId: string, logoKey: string, logoWidths: number[]): Promise<ProfileRecord> {
      return db.organization.update({
        where: { id: organizationId },
        data: { logoKey, logoWidths },
        select: profileSelect,
      });
    },

    /** `null` removes the cover (the file stays in storage: keys are content-addressed). */
    setCover(
      organizationId: string,
      coverKey: string | null,
      coverWidths: number[],
    ): Promise<ProfileRecord> {
      return db.organization.update({
        where: { id: organizationId },
        data: { coverKey, coverWidths },
        select: profileSelect,
      });
    },
  };
}

export type ProfileRepository = ReturnType<typeof createProfileRepository>;
