import { ErrorCode, type OrganizationProfile, type UpdateProfileRequest } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { type Cache, cacheKeys } from '#src/lib/cache';
import {
  LOGO_CACHE_CONTROL,
  LogoRejectedError,
  processCover,
  processLogo,
  type ProcessedLogo,
} from '#src/lib/logo';
import type { PublicUrl } from '#src/lib/public-url';
import type { Storage } from '#src/lib/storage';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { ProfileRecord, ProfileRepository } from '#src/repositories/profile.repository';
import type { OrgRef } from '#src/services/access.service';
import type { Actor } from '#src/services/document.service';
import { profileLinksOf } from '#src/services/organization.service';

export interface ProfileServiceDeps {
  profiles: ProfileRepository;
  storage: Pick<Storage, 'put'>;
  audit: Pick<AuditLogRepository, 'record'>;
  cache: Cache;
  publicUrl: PublicUrl;
}

const invalid = (message: string) => new AppError(400, ErrorCode.VALIDATION_ERROR, message);

/** The fields a save compares, for the audit entry's list of what changed. */
const TEXT_FIELDS = ['description', 'mission', 'vision', 'contactEmail', 'facebookUrl'] as const;

function changedFields(before: ProfileRecord, input: UpdateProfileRequest): string[] {
  const changed: string[] = TEXT_FIELDS.filter((field) => before[field] !== input[field]);
  const links = before.links.map((link) => link.url);
  if (JSON.stringify(links) !== JSON.stringify(input.links)) changed.push('links');
  if (JSON.stringify(before.officers) !== JSON.stringify(input.officers)) changed.push('officers');
  return changed;
}

/**
 * The organization's own profile (/dashboard/profile). The route lets only its own account
 * in (requireOwnOrg); name, acronym, type and college stay with the ISSC (/admin). Every save
 * is audited with who acted for the account and clears the public pages that show it.
 */
export function createProfileService({
  profiles,
  storage,
  audit,
  cache,
  publicUrl,
}: ProfileServiceDeps) {
  function toProfile(record: ProfileRecord): OrganizationProfile {
    return {
      slug: record.slug,
      official: {
        name: record.name,
        acronym: record.acronym,
        type: record.type,
        college: record.college,
      },
      description: record.description,
      mission: record.mission,
      vision: record.vision,
      contactEmail: record.contactEmail,
      facebookUrl: record.facebookUrl,
      links: profileLinksOf(null, record.links),
      officers: record.officers,
      logoUrl: publicUrl(record.logoKey),
      coverUrl: publicUrl(record.coverKey),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async function load(org: OrgRef): Promise<ProfileRecord> {
    const record = await profiles.findById(org.id);
    if (!record) throw AppError.notFound('Organization not found');
    return record;
  }

  /** The organization page, the college pages (CSC cards) and leaderboard logos. */
  function invalidate(org: OrgRef) {
    return Promise.all([
      cache.deleteMatching(cacheKeys.organization(org.slug)),
      cache.deleteMatching('college:*'),
      cache.deleteMatching(cacheKeys.leaderboardOrganizations()),
    ]);
  }

  function auditChange(
    actor: Actor,
    org: OrgRef,
    change: string,
    actingAs: string,
    details: Record<string, unknown> = {},
  ) {
    return audit.record({
      action: 'organization_change',
      actorId: actor.userId,
      entityType: 'organization',
      entityId: org.id,
      organizationId: org.id,
      metadata: { change, ...details },
      ip: actor.ip,
      actingAs,
    });
  }

  /** Turns an image the processing refused into a 400 the form can show on its field. */
  async function processed(
    field: 'logo' | 'cover',
    run: () => Promise<ProcessedLogo>,
  ): Promise<ProcessedLogo> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof LogoRejectedError) throw invalid(`${field}: ${err.message}`);
      throw invalid(`${field}: This image could not be read`);
    }
  }

  async function store(image: ProcessedLogo) {
    for (const file of image.files) {
      await storage.put(file.key, file.body, 'image/webp', LOGO_CACHE_CONTROL);
    }
  }

  return {
    async get(org: OrgRef): Promise<OrganizationProfile> {
      return toProfile(await load(org));
    },

    /** Replaces every editable field at once (the editor saves the whole form). */
    async save(
      actor: Actor,
      org: OrgRef,
      input: UpdateProfileRequest,
    ): Promise<OrganizationProfile> {
      const before = await load(org);
      const { actingAs, ...fields } = input;
      const saved = await profiles.save(org.id, fields);
      await auditChange(actor, org, 'profile', actingAs, {
        fields: changedFields(before, input),
      });
      await invalidate(org);
      return toProfile(saved);
    },

    /** A logo from the editor's cropper: centre-cropped to a square as a backstop. */
    async setLogo(
      actor: Actor,
      org: OrgRef,
      body: Buffer,
      actingAs: string,
    ): Promise<OrganizationProfile> {
      const logo = await processed('logo', () => processLogo(org.slug, body, { square: true }));
      await store(logo);
      const saved = await profiles.setLogo(org.id, logo.key, logo.widths);
      await auditChange(actor, org, 'logo', actingAs, { key: logo.key });
      await invalidate(org);
      return toProfile(saved);
    },

    async setCover(
      actor: Actor,
      org: OrgRef,
      body: Buffer,
      actingAs: string,
    ): Promise<OrganizationProfile> {
      const cover = await processed('cover', () => processCover(org.slug, body));
      await store(cover);
      const saved = await profiles.setCover(org.id, cover.key, cover.widths);
      await auditChange(actor, org, 'cover', actingAs, { key: cover.key });
      await invalidate(org);
      return toProfile(saved);
    },

    async removeCover(actor: Actor, org: OrgRef, actingAs: string): Promise<OrganizationProfile> {
      const before = await load(org);
      if (!before.coverKey) return toProfile(before);
      const saved = await profiles.setCover(org.id, null, []);
      await auditChange(actor, org, 'cover_removed', actingAs);
      await invalidate(org);
      return toProfile(saved);
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
