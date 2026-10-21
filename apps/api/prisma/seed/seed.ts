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
import { documentVisibilitySchema, semesterSchema } from '@orghive/shared';
import { loadConfig } from '#src/config';
import { pdfText } from '#src/lib/file-processing';
import { LOGO_CACHE_CONTROL, logoWidthsFor } from '#src/lib/logo';
import { logoVariantKey } from '#src/lib/public-url';
import { createBullPreviewQueue, createQueueConnection } from '#src/lib/queue';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createDb, type Db } from '#src/repositories/prisma';
import { queuePendingPreviews } from '#src/services/preview.service';
import {
  colleges,
  cscSlug,
  documentTypes,
  issc,
  sbosByCollege,
  accountEmail,
  officersInCharge,
} from './data';

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
      // Sample Paperworks stand for the public archive unless a row says otherwise.
      visibility: documentVisibilitySchema.default('public'),
    }),
  ),
});

/** The academic year starts in August; seeded officer terms cover the current one. */
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

  for (const c of colleges) {
    const college = await db.college.findUniqueOrThrow({ where: { code: c.code } });
    const csc = orgIds.get(cscSlug(c.slug))!;
    for (const [index, sbo] of (sbosByCollege[c.code] ?? []).entries()) {
      const data = { acronym: sbo.acronym, name: sbo.name, description: sbo.description ?? null };
      const org = await db.organization.upsert({
        where: { slug: sbo.slug },
        update: data,
        // Carousel position only on create: admins may have reordered them since.
        create: {
          type: 'SBO',
          slug: sbo.slug,
          parentId: csc,
          collegeId: college.id,
          position: index,
          ...data,
        },
      });
      orgIds.set(org.slug, org.id);
    }
  }
  return orgIds;
}

async function putPublicLogo(key: string, body: Buffer) {
  if (await objectExists(key)) return;
  await s3.send(
    new PutObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'image/webp',
      CacheControl: LOGO_CACHE_CONTROL,
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

/**
 * Queues the watermarked page images of every seeded file still without them, as the backfill
 * does; the worker (pnpm dev) renders them. Until then their viewer says "Preparing preview…".
 */
async function queueSeedPreviews(db: Db): Promise<number> {
  const connection = createQueueConnection(config.REDIS_URL);
  const queue = createBullPreviewQueue(connection);
  try {
    return await queuePendingPreviews({ documents: createDocumentRepository(db), queue });
  } finally {
    await queue.queue.close();
    await connection.quit();
  }
}

/** Public reads are cached in Redis for 10 minutes; drop them so seeded changes show at once. */
async function clearPublicReadCache() {
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
  try {
    for (const pattern of ['college:*', 'org:*', 'search:*']) {
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

/**
 * One shared account per organization, each with its officer-in-charge for this term. The
 * password is SEED_PASSWORD, so every account must replace it on first login.
 */
async function seedAccounts(db: Db, orgIds: Map<string, string>) {
  const term = currentTerm();
  const passwordHash = await argon2.hash(seedPassword, { type: argon2.argon2id });
  const accounts = new Map<string, string>();
  for (const [slug, organizationId] of orgIds) {
    const org = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { acronym: true },
    });
    const email = accountEmail(slug);
    const user = await db.user.upsert({
      where: { email },
      update: { name: org.acronym, organizationId },
      create: {
        email,
        name: org.acronym,
        organizationId,
        passwordHash,
        mustChangePassword: true,
      },
    });
    accounts.set(slug, user.id);

    const officer = officersInCharge[slug] ?? {
      name: 'Not on record',
      position: 'Officer-in-charge',
    };
    const open = await db.officerTerm.findFirst({ where: { userId: user.id, endedAt: null } });
    if (!open) {
      await db.officerTerm.create({
        data: {
          userId: user.id,
          organizationId,
          officerName: officer.name,
          officerPosition: officer.position,
          officerEmail: email,
          termStart: term.start,
          termEnd: term.end,
        },
      });
    }
  }
  return accounts;
}

async function seedDocuments(db: Db, orgIds: Map<string, string>, accounts: Map<string, string>) {
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
    const body = readFileSync(join(SEED_DIR, 'assets', `${doc.slug}.pdf`));
    const existing = await db.documentVersion.findUnique({
      where: { storageKey },
      select: { document: { select: { id: true, contentText: true } } },
    });
    if (existing) {
      // Seeded before search read file text: fill it in, as the worker does for uploads.
      if (existing.document.contentText === null) {
        await db.document.update({
          where: { id: existing.document.id },
          data: { contentText: (await pdfText(body)) || null },
        });
      }
      continue;
    }

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

    // A document is uploaded by its organization's shared account.
    const createdById = accounts.get(doc.org)!;
    // Seed files are known to be clean, so the documents are available straight away.
    const document = await db.document.create({
      data: {
        organizationId: orgIds.get(doc.org)!,
        typeId: types.get(doc.type)!,
        title: doc.title,
        description: doc.description,
        academicYear: doc.academicYear,
        semester: doc.semester,
        status: 'available',
        visibility: doc.visibility,
        // What the worker extracts from an upload, so the file's text is searchable.
        contentText: (await pdfText(body)) || null,
        createdById,
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

    created++;
  }
  return { created, total: manifest.documents.length };
}

async function main() {
  const db = createDb(config.DATABASE_URL);
  try {
    const orgIds = await seedOrganizations(db);
    const accounts = await seedAccounts(db, orgIds);
    const docs = await seedDocuments(db, orgIds, accounts);
    const logos = await seedLogos(db);
    await clearPublicReadCache();
    const previews = await queueSeedPreviews(db);
    console.log(
      `Seeded ${orgIds.size} organizations, ${colleges.length} colleges, ${accounts.size} accounts (one per organization).`,
    );
    console.log(`Logos: ${logos} updated. Public read cache cleared.`);
    console.log(
      `Sample documents: ${docs.created} created, ${docs.total - docs.created} already present. ${previews} queued for their view-only preview.`,
    );
    console.log(
      `Sign in as <organization slug>@orghive.local, e.g. ${accountEmail('jpice')}, ${accountEmail('csc-cea')}, ${accountEmail('issc')} (password: SEED_PASSWORD)`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
