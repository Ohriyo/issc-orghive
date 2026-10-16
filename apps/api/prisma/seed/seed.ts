// Seeds organizations, development users and the sample Paperworks.
// Safe to run repeatedly: everything is matched by slug, code, email or storage key.
// Run with: pnpm --filter api db:seed
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import argon2 from 'argon2';
import { Redis } from 'ioredis';
import sharp from 'sharp';
import { z } from 'zod';
import { documentStatusSchema, documentVisibilitySchema, semesterSchema } from '@orghive/shared';
import { loadConfig } from '#src/config';
import { logoVariantKey } from '#src/lib/public-url';
import { createDb, type Db } from '#src/repositories/prisma';
import { ceaSbos, colleges, cscSlug, documentTypes, issc, users, type SeedUserKey } from './data';

const SEED_DIR = import.meta.dirname;

if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig();
const seedPassword = z
  .string({ error: 'Set SEED_PASSWORD in apps/api/.env (see .env.example)' })
  .min(12, 'SEED_PASSWORD must be at least 12 characters')
  .parse(process.env.SEED_PASSWORD);

const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});

async function objectExists(key: string): Promise<boolean> {
  return s3
    .send(new HeadObjectCommand({ Bucket: config.S3_BUCKET, Key: key }))
    .then(() => true)
    .catch(() => false);
}

const manifestSchema = z.object({
  documents: z.array(
    z.object({
      slug: z.string(),
      org: z.string(),
      type: z.string(),
      title: z.string(),
      description: z.string(),
      academicYear: z.string(),
      semester: semesterSchema,
      status: documentStatusSchema,
      // Sample Paperworks stand for the public archive unless a row says otherwise.
      visibility: documentVisibilitySchema.default('public'),
      createdBy: z.enum(['admin', 'jpice-officer', 'jpice-adviser', 'cea-governor']),
    }),
  ),
});

/** The academic year starts in August; seeded memberships cover the current one. */
function currentTerm(now = new Date()) {
  const startYear = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return {
    start: new Date(Date.UTC(startYear, 7, 1)),
    end: new Date(Date.UTC(startYear + 1, 6, 31)),
  };
}

async function seedOrganizations(db: Db) {
  const isscOrg = await db.organization.upsert({
    where: { slug: issc.slug },
    update: { name: issc.name, acronym: issc.acronym, description: issc.description },
    create: { type: 'ISSC', ...issc },
  });

  const orgIds = new Map<string, string>([[isscOrg.slug, isscOrg.id]]);
  for (const c of colleges) {
    const college = await db.college.upsert({
      where: { code: c.code },
      update: { slug: c.slug, name: c.name, motto: c.motto, description: c.description ?? null },
      create: {
        code: c.code,
        slug: c.slug,
        name: c.name,
        motto: c.motto,
        description: c.description,
      },
    });
    const csc = {
      acronym: `CSC-${c.code}`,
      name: `Collegiate Student Council of the ${c.name}`,
      description: c.cscDescription ?? null,
    };
    const org = await db.organization.upsert({
      where: { slug: cscSlug(c.slug) },
      update: csc,
      create: {
        type: 'CSC',
        slug: cscSlug(c.slug),
        parentId: isscOrg.id,
        collegeId: college.id,
        ...csc,
      },
    });
    orgIds.set(org.slug, org.id);
  }

  const cea = await db.college.findUniqueOrThrow({ where: { code: 'CEA' } });
  const cscCea = orgIds.get(cscSlug('cea'))!;
  for (const sbo of ceaSbos) {
    const data = { acronym: sbo.acronym, name: sbo.name, description: sbo.description ?? null };
    const org = await db.organization.upsert({
      where: { slug: sbo.slug },
      update: data,
      create: { type: 'SBO', slug: sbo.slug, parentId: cscCea, collegeId: cea.id, ...data },
    });
    orgIds.set(org.slug, org.id);
  }
  return orgIds;
}

/** Widths for srcset. Never larger than the source: upscaling adds bytes, not detail. */
const LOGO_WIDTHS = [128, 256, 512, 1024];

function logoWidthsFor(sourceWidth: number): number[] {
  const widths = LOGO_WIDTHS.filter((w) => w < sourceWidth);
  return [...widths, Math.min(sourceWidth, LOGO_WIDTHS.at(-1)!)];
}

async function putPublicLogo(key: string, body: Buffer) {
  if (await objectExists(key)) return;
  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

/**
 * Uploads assets/logos/<org-slug>.webp to the public-read `logos/` prefix and sets each
 * organization's logoKey. The key includes a content hash, so a replaced logo gets a new
 * URL and CDNs can cache logos forever. Resized copies for srcset are stored next to it
 * (`<key>-<width>.webp`) and their widths recorded in logoWidths. Colleges have no logo of
 * their own yet; their seals are used as the CSC logos for now.
 */
async function seedLogos(db: Db) {
  const dir = join(SEED_DIR, 'assets', 'logos');
  let updated = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.webp'))) {
    const slug = file.replace(/\.webp$/, '');
    const body = readFileSync(join(dir, file));
    const hash = createHash('sha256').update(body).digest('hex').slice(0, 12);
    const key = `logos/${slug}-${hash}.webp`;
    await putPublicLogo(key, body);

    const { width: sourceWidth } = await sharp(body).metadata();
    const widths = logoWidthsFor(sourceWidth);
    for (const width of widths) {
      const resized = await sharp(body).resize({ width }).webp({ quality: 82 }).toBuffer();
      await putPublicLogo(logoVariantKey(key, width), resized);
    }

    const { count } = await db.organization.updateMany({
      // `not` alone skips NULL (SQL three-valued logic), so match a missing logo explicitly.
      // Also catches logos seeded before variants existed (logoWidths still empty).
      where: {
        slug,
        OR: [{ logoKey: null }, { logoKey: { not: key } }, { logoWidths: { isEmpty: true } }],
      },
      data: { logoKey: key, logoWidths: widths },
    });
    updated += count;
  }
  return updated;
}

/** Public reads are cached in Redis for 10 minutes; drop them so seeded changes show at once. */
async function clearPublicReadCache() {
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    for (const pattern of ['college:*', 'org:*']) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        if (keys.length > 0) await redis.del(...keys);
        cursor = next;
      } while (cursor !== '0');
    }
  } finally {
    redis.disconnect();
  }
}

async function seedUsers(db: Db, orgIds: Map<string, string>) {
  const term = currentTerm();
  const userIds = new Map<SeedUserKey, string>();
  for (const u of users) {
    const user = await db.user.upsert({
      where: { email: u.email },
      update: { name: u.name },
      create: {
        email: u.email,
        name: u.name,
        passwordHash: await argon2.hash(seedPassword, { type: argon2.argon2id }),
        // SEED_PASSWORD is shared, so every seeded account must replace it on first login.
        mustChangePassword: true,
      },
    });
    userIds.set(u.key, user.id);

    const organizationId = orgIds.get(u.org)!;
    await db.membership.upsert({
      where: {
        userId_organizationId_role_termStart: {
          userId: user.id,
          organizationId,
          role: u.role,
          termStart: term.start,
        },
      },
      update: { isHead: u.isHead, title: u.title, termEnd: u.openEnded ? null : term.end },
      create: {
        userId: user.id,
        organizationId,
        role: u.role,
        isHead: u.isHead,
        title: u.title,
        termStart: term.start,
        termEnd: u.openEnded ? null : term.end,
      },
    });
  }
  return userIds;
}

async function seedDocuments(
  db: Db,
  orgIds: Map<string, string>,
  userIds: Map<SeedUserKey, string>,
) {
  const types = new Map<string, string>();
  for (const t of documentTypes) {
    const row = await db.documentType.upsert({
      where: { slug: t.slug },
      update: { name: t.name },
      create: t,
    });
    types.set(t.slug, row.id);
  }

  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(SEED_DIR, 'sample-documents.json'), 'utf8')),
  );
  let created = 0;

  for (const doc of manifest.documents) {
    const storageKey = `seed/documents/${doc.slug}/v1.pdf`;
    if (await db.documentVersion.findUnique({ where: { storageKey } })) continue;

    const body = readFileSync(join(SEED_DIR, 'assets', `${doc.slug}.pdf`));
    const sha256 = createHash('sha256').update(body).digest('hex');
    if (!(await objectExists(storageKey))) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: storageKey,
          Body: body,
          ContentType: 'application/pdf',
          ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
        }),
      );
    }

    const createdById = userIds.get(doc.createdBy)!;
    const submitted = doc.status !== 'draft';
    const document = await db.document.create({
      data: {
        organizationId: orgIds.get(doc.org)!,
        typeId: types.get(doc.type)!,
        title: doc.title,
        description: doc.description,
        academicYear: doc.academicYear,
        semester: doc.semester,
        status: doc.status,
        visibility: doc.visibility,
        createdById,
        submittedAt: submitted ? new Date() : null,
      },
    });
    const version = await db.documentVersion.create({
      data: {
        documentId: document.id,
        version: 1,
        storageKey,
        originalFilename: `${doc.slug}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: body.length,
        sha256,
        // Seed fixtures are generated locally and known to be clean.
        scanStatus: 'clean',
        uploadedById: createdById,
      },
    });
    await db.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });

    // JPICE decisions come from its seeded approver, the CEA Governor. Approved CSC and ISSC
    // samples stand for older paperwork imported into the archive, so they have no approval row.
    if (doc.org === 'jpice' && (doc.status === 'approved' || doc.status === 'rejected')) {
      await db.approval.create({
        data: {
          documentId: document.id,
          versionId: version.id,
          approverId: userIds.get('cea-governor')!,
          decision: doc.status,
          comment:
            doc.status === 'rejected'
              ? 'Liquidation receipts are incomplete. Attach them and resubmit.'
              : null,
        },
      });
    }
    created++;
  }
  return { created, total: manifest.documents.length };
}

async function main() {
  const db = createDb(config.DATABASE_URL);
  try {
    const orgIds = await seedOrganizations(db);
    const userIds = await seedUsers(db, orgIds);
    const docs = await seedDocuments(db, orgIds, userIds);
    const logos = await seedLogos(db);
    await clearPublicReadCache();
    console.log(
      `Seeded ${orgIds.size} organizations, ${colleges.length} colleges, ${users.length} users.`,
    );
    console.log(`Logos: ${logos} updated. Public read cache cleared.`);
    console.log(
      `Sample documents: ${docs.created} created, ${docs.total - docs.created} already present.`,
    );
    console.log(
      `Sign-in emails: ${users.map((u) => u.email).join(', ')} (password: SEED_PASSWORD)`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
