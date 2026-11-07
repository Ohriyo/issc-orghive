import sharp from 'sharp';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTING_AS_HEADER,
  POST_IMAGE_KEY_PATTERN,
  type ManagedPost,
  type ManagedPostListResponse,
  type OrganizationPage,
  type PostDetail,
  type PostListResponse,
  type UploadedPostImage,
} from '@orghive/shared';
import { memoryCache } from '#src/lib/cache';
import type { ScanResult } from '#src/lib/clamav';
import { createPublicUrl } from '#src/lib/public-url';
import { createAccountRepository } from '#src/repositories/account.repository';
import { createAuditLogRepository } from '#src/repositories/audit-log.repository';
import { createDocumentRepository } from '#src/repositories/document.repository';
import { createOrganizationRepository } from '#src/repositories/organization.repository';
import { createOrgPostRepository } from '#src/repositories/org-post.repository';
import { createProjectRepository } from '#src/repositories/project.repository';
import { createAccessService } from '#src/services/access.service';
import { createOrganizationService } from '#src/services/organization.service';
import { createOrgPostService, type OrgPostService } from '#src/services/org-post.service';
import { createRecipients } from '#src/services/recipients.service';
import { createTokenService } from '#src/services/token.service';
import { testKeys } from './auth-fixtures';
import { buildComplianceWorld, type Person } from './compliance-fixtures';
import { testDb } from './db';
import { buildTestApp, TEST_ASSET_BASE_URL } from './helpers';

const db = testDb();
const tokens = createTokenService(testKeys());
let app: ReturnType<typeof buildTestApp>;
let service: OrgPostService;
let ids: Record<Person, string>;
let clock = new Date('2026-11-06T02:00:00Z');
const notify = vi.fn();
const put = vi.fn();
let scanResult: ScanResult = { clean: true };

const tokenOf = {} as Record<Person, string>;

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
function call(method: Method, path: string, person?: Person) {
  const req = request(app)[method](`/api/v1${path}`);
  return person ? req.set('Authorization', `Bearer ${tokenOf[person]}`) : req;
}

const ACTING = { actingAs: 'Maria Santos' };
const HIGHLIGHT = {
  type: 'HIGHLIGHT',
  title: 'IT Days 2026',
  summary: 'Two days of games and talks.',
  body: '## Day one\n\nGames **all day**. <script>alert(1)</script>',
  action: 'publish',
  ...ACTING,
};
const UPDATE = { ...HIGHLIGHT, type: 'UPDATE', title: 'Fee deadline moved' };

function create(body: object, person: Person = 'officer', slug = 'jpice') {
  return call('post', `/organizations/${slug}/posts`, person).send(body);
}

async function created(body: object, person: Person = 'officer', slug = 'jpice') {
  const res = await create(body, person, slug);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as ManagedPost;
}

beforeAll(async () => {
  const built = await buildComplianceWorld(db);
  ids = built.ids;
  for (const person of Object.keys(ids) as Person[]) {
    const { token } = await tokens.sign({ userId: ids[person], passwordChangeRequired: false });
    tokenOf[person] = token;
  }
  const accounts = createAccountRepository(db);
  const organizations = createOrganizationRepository(db);
  const cache = memoryCache();
  const publicUrl = createPublicUrl(TEST_ASSET_BASE_URL);
  service = createOrgPostService({
    posts: createOrgPostRepository(db),
    organizations: createOrganizationService({ organizations, cache, publicUrl }),
    accounts,
    recipients: createRecipients({ accounts, organizations }),
    notifications: { notify },
    audit: createAuditLogRepository(db),
    cache,
    storage: { put },
    scanner: { scan: () => Promise.resolve(scanResult) },
    publicUrl,
    now: () => clock,
  });
  app = buildTestApp({
    tokens,
    access: createAccessService({
      accounts,
      organizations,
      documents: createDocumentRepository(db),
      projects: createProjectRepository(db),
    }),
    organizations: createOrganizationService({ organizations, cache, publicUrl }),
    posts: service,
  });
});

beforeEach(async () => {
  await db.orgPost.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.updateMany({ where: { id: ids.governor }, data: { disabledAt: null } });
  clock = new Date('2026-11-06T02:00:00Z');
  notify.mockReset();
  put.mockReset();
  scanResult = { clean: true };
});

describe('who may write', () => {
  it('401s signed out on every write', async () => {
    await call('post', '/organizations/jpice/posts').send(HIGHLIGHT).expect(401);
    await call('get', '/organizations/jpice/manage/posts').expect(401);
    await call('put', '/organizations/jpice/highlights/pinned').send({}).expect(401);
    await call('post', `/organizations/jpice/posts/${ids.officer}/hide`).send({}).expect(401);
  });

  it('403s every account but the organization’s own, its governing bodies included', async () => {
    for (const person of ['governor', 'isscPresident', 'psmeOfficer', 'catGovernor'] as const) {
      expect((await create(HIGHLIGHT, person)).status, person).toBe(403);
      expect((await call('get', '/organizations/jpice/manage/posts', person)).status).toBe(403);
    }
  });

  it('400s a body without "Acting as" or with a bad field', async () => {
    const { actingAs: _drop, ...noActing } = HIGHLIGHT;
    expect((await create(noActing)).status).toBe(400);
    expect((await create({ ...HIGHLIGHT, title: 'x' })).status).toBe(400);
  });
});

describe('publishing', () => {
  it('keeps drafts off public pages, but shows them to the own account', async () => {
    const draft = await created({ ...HIGHLIGHT, action: 'draft' });
    expect(draft).toMatchObject({ status: 'DRAFT', slug: 'it-days-2026', actingAs: 'Maria Santos' });

    await call('get', `/organizations/jpice/posts/${draft.slug}`).expect(404);
    const list = call('get', '/organizations/jpice/posts').expect(200);
    expect(((await list).body as PostListResponse).items).toEqual([]);

    const own = await call('get', `/organizations/jpice/posts/${draft.slug}`, 'officer');
    expect(own.status).toBe(200);
    expect((own.body as PostDetail).viewer).toEqual({ isOwner: true, canModerate: false });
  });

  it('publishes at once, sanitizes the body and audits who acted', async () => {
    const post = await created(HIGHLIGHT);
    expect(post.status).toBe('PUBLISHED');
    const res = await call('get', `/organizations/jpice/posts/${post.slug}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('public');
    const detail = res.body as PostDetail;
    expect(detail.bodyHtml).toContain('<h2>Day one</h2>');
    expect(detail.bodyHtml).not.toContain('<script');
    expect(detail).not.toHaveProperty('actingAs');

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: post.id } });
    expect(audit).toMatchObject({ action: 'post_change', actingAs: 'Maria Santos' });
  });

  it('gives a repeated title the next free slug', async () => {
    await created(HIGHLIGHT);
    expect((await created(HIGHLIGHT)).slug).toBe('it-days-2026-2');
  });

  it('schedules for later: live once due, then published by the job', async () => {
    const at = '2026-11-06T18:00:00+08:00';
    const post = await created({ ...UPDATE, action: 'schedule', publishAt: at });
    expect(post).toMatchObject({ status: 'SCHEDULED', publishAt: '2026-11-06T10:00:00.000Z' });
    await call('get', `/organizations/jpice/posts/${post.slug}`).expect(404);

    clock = new Date('2026-11-06T10:00:01Z');
    await call('get', `/organizations/jpice/posts/${post.slug}?fresh=1`).expect(200);
    expect(await service.publishDue()).toBe(1);
    expect(await service.publishDue()).toBe(0);
    const row = await db.orgPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.status).toBe('PUBLISHED');
  });

  it('refuses a schedule in the past and publishing twice', async () => {
    const past = await create({ ...UPDATE, action: 'schedule', publishAt: '2026-11-05T09:00:00Z' });
    expect(past.status).toBe(400);
    const post = await created(UPDATE);
    const again = call('post', `/organizations/jpice/posts/${post.id}/publish`, 'officer');
    expect((await again.send(ACTING)).status).toBe(409);
  });

  it('edits, unpublishes and deletes', async () => {
    const post = await created(UPDATE);
    const edit = await call('patch', `/organizations/jpice/posts/${post.id}`, 'officer').send({
      ...ACTING,
      title: 'Fee deadline moved to Nov 20',
      summary: 'New date.',
    });
    expect(edit.status).toBe(200);
    expect((edit.body as ManagedPost).slug).toBe(post.slug);

    const off = call('post', `/organizations/jpice/posts/${post.id}/unpublish`, 'officer');
    expect(((await off.send(ACTING)).body as ManagedPost).status).toBe('DRAFT');

    const del = call('delete', `/organizations/jpice/posts/${post.id}`, 'officer');
    expect((await del.send(ACTING)).status).toBe(204);
    const again = call('delete', `/organizations/jpice/posts/${post.id}`, 'officer');
    expect((await again.send(ACTING)).status).toBe(404);
    const deleted = await db.auditLog.findFirst({ where: { entityId: post.id, action: 'delete' } });
    expect(deleted?.actingAs).toBe('Maria Santos');
  });
});

describe('the organization page and lists', () => {
  it('shows pinned highlights in order and the newest updates', async () => {
    const a = await created({ ...HIGHLIGHT, title: 'First highlight' });
    const b = await created({ ...HIGHLIGHT, title: 'Second highlight' });
    const draft = await created({ ...HIGHLIGHT, title: 'Draft highlight', action: 'draft' });
    for (let i = 0; i < 6; i++) await created({ ...UPDATE, title: `Update number ${i}` });

    const pin = async (postIds: string[]) =>
      call('put', '/organizations/jpice/highlights/pinned', 'officer').send({
        ...ACTING,
        postIds,
      });
    expect((await pin([b.id, a.id])).status).toBe(204);
    expect((await pin([draft.id])).status).toBe(409);
    expect((await pin(Array.from({ length: 7 }, () => a.id))).status).toBe(400);

    const page = (await call('get', '/organizations/jpice/page')).body as OrganizationPage;
    expect(page.organization.slug).toBe('jpice');
    expect(page.highlights.map((h) => h.title)).toEqual(['Second highlight', 'First highlight']);
    expect(page.updates).toHaveLength(5);
    expect(page.updatesTotal).toBe(6);
    expect(page.viewer).toEqual({ isOwner: false, canModerate: false });

    const asGovernor = (await call('get', '/organizations/jpice/page', 'governor')).body as OrganizationPage;
    expect(asGovernor.viewer).toEqual({ isOwner: false, canModerate: true });

    const own = (await call('get', '/organizations/jpice/manage/posts?type=highlight', 'officer'))
      .body as ManagedPostListResponse;
    expect(own.total).toBe(3);
    expect(own.pinnedCount).toBe(2);
  });

  it('filters by type and Manila year, and links neighbours', async () => {
    clock = new Date('2025-12-31T17:00:00Z'); // 1 am, January 1st 2026 in Manila
    const old = await created({ ...UPDATE, title: 'New year post' });
    clock = new Date('2026-11-06T02:00:00Z');
    const mid = await created({ ...HIGHLIGHT, title: 'Middle post' });
    const latest = await created({ ...UPDATE, title: 'Latest post' });

    const updates = (await call('get', '/organizations/jpice/posts?type=update')).body as PostListResponse;
    expect(updates.items.map((p) => p.slug)).toEqual([latest.slug, old.slug]);
    expect(updates.years).toEqual([2026]);
    const in2025 = (await call('get', '/organizations/jpice/posts?year=2025')).body as PostListResponse;
    expect(in2025.total).toBe(0);
    await call('get', '/organizations/jpice/posts?type=news').expect(400);

    const detail = (await call('get', `/organizations/jpice/posts/${mid.slug}`)).body as PostDetail;
    expect(detail.previous?.slug).toBe(old.slug);
    expect(detail.next?.slug).toBe(latest.slug);
  });

  it('serves an RSS feed of live posts', async () => {
    await created(UPDATE);
    await created({ ...UPDATE, title: 'A draft & more', action: 'draft' });
    const res = await call('get', '/organizations/jpice/posts/rss.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/rss+xml');
    expect(res.text).toContain('<title>Fee deadline moved</title>');
    expect(res.text).toContain('/orgs/jpice/updates/fee-deadline-moved');
    expect(res.text).not.toContain('A draft');
  });
});

describe('hiding a post', () => {
  const hide = async (person: Person, postId: string, slug = 'jpice') =>
    call('post', `/organizations/${slug}/posts/${postId}/hide`, person).send({
      actingAs: 'Gov',
      reason: 'Shares a student’s phone number',
    });

  it('lets only the parent CSC hide an SBO post, and tells the organization why', async () => {
    const post = await created(HIGHLIGHT);
    await call('put', '/organizations/jpice/highlights/pinned', 'officer').send({
      ...ACTING,
      postIds: [post.id],
    });
    for (const person of ['psmeOfficer', 'catGovernor', 'isscPresident', 'officer'] as const) {
      expect((await hide(person, post.id)).status, person).toBe(403);
    }
    expect((await hide('governor', post.id)).status).toBe(204);

    await call('get', `/organizations/jpice/posts/${post.slug}`).expect(404);
    const page = (await call('get', '/organizations/jpice/page')).body as OrganizationPage;
    expect(page.highlights).toEqual([]);
    const own = (await call('get', `/organizations/jpice/posts/${post.slug}`, 'officer'))
      .body as PostDetail;
    expect(own.moderation?.reason).toBe('Shares a student’s phone number');
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'post_hidden', userIds: [ids.officer] }),
    );
    expect(await db.orgPost.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({
      status: 'HIDDEN',
      pinned: false,
    });

    // The organization may publish it again.
    const again = call('post', `/organizations/jpice/posts/${post.id}/publish`, 'officer');
    const republished = (await again.send(ACTING)).body as ManagedPost;
    expect(republished).toMatchObject({ status: 'PUBLISHED', moderation: null });
  });

  it('409s hiding what is not live', async () => {
    const draft = await created({ ...HIGHLIGHT, action: 'draft' });
    expect((await hide('governor', draft.id)).status).toBe(409);
  });

  it('lets the ISSC step in while the CSC seat is vacant, audited as an override', async () => {
    const post = await created(UPDATE);
    await db.user.update({ where: { id: ids.governor }, data: { disabledAt: new Date() } });
    expect((await hide('isscPresident', post.id)).status).toBe(204);
    const override = await db.auditLog.findFirst({ where: { action: 'admin_override' } });
    expect(override?.entityId).toBe(post.id);
  });

  it('never hides the ISSC’s own posts', async () => {
    const post = await created(UPDATE, 'isscPresident', 'issc');
    expect((await hide('governor', post.id, 'issc')).status).toBe(403);
    expect((await hide('isscPresident', post.id, 'issc')).status).toBe(403);
  });
});

describe('post images', () => {
  async function png(width: number) {
    return sharp({
      create: { width, height: Math.round(width * 0.75), channels: 3, background: '#429644' },
    })
      .withExif({ IFD0: { Copyright: 'secret' } })
      .png()
      .toBuffer();
  }

  async function upload(body: Buffer, person: Person = 'officer') {
    return call('post', '/organizations/jpice/post-images', person)
      .set('Content-Type', 'image/png')
      .set(ACTING_AS_HEADER, encodeURIComponent('Maria Santos'))
      .send(body);
  }

  it('scans, converts to WebP without metadata, and returns an unguessable key', async () => {
    const res = await upload(await png(1000));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const uploaded = res.body as UploadedPostImage;
    expect(uploaded.key).toMatch(POST_IMAGE_KEY_PATTERN);
    expect(uploaded.widths).toEqual([480, 960]);
    const stored = put.mock.calls[0]![1] as Buffer;
    expect((await sharp(stored).metadata()).exif).toBeUndefined();

    const post = await created({
      ...HIGHLIGHT,
      cover: { key: uploaded.key, widths: uploaded.widths, alt: 'Students at the court' },
    });
    const card = ((await call('get', '/organizations/jpice/posts')).body as PostListResponse).items[0]!;
    expect(card.cover?.alt).toBe('Students at the court');
    expect(card.cover?.srcSet).toContain('480w');
    expect(post.cover?.url).toContain(TEST_ASSET_BASE_URL);
  });

  it('refuses infected, small or foreign images', async () => {
    scanResult = { clean: false, signature: 'Eicar-Test' };
    expect((await upload(await png(1000))).status).toBe(400);
    scanResult = { clean: true };
    expect((await upload(await png(300))).status).toBe(400);
    expect((await upload(await png(1000), 'governor')).status).toBe(403);

    const foreign = `logos/posts/psme/${'a'.repeat(24)}-${'b'.repeat(12)}.webp`;
    const res = await create({ ...HIGHLIGHT, cover: { key: foreign, widths: [], alt: 'x' } });
    expect(res.status).toBe(400);
  });
});

describe('edge cases', () => {
  it('ignores malformed gallery entries and 404s posts of other organizations', async () => {
    const post = await created(UPDATE);
    await db.orgPost.update({
      where: { id: post.id },
      data: {
        gallery: [
          null,
          'x',
          { key: 1, alt: 'a', widths: [] },
          { key: `logos/posts/jpice/${'c'.repeat(24)}-${'d'.repeat(12)}.webp`, alt: 'ok', widths: [480, 'x'] },
        ],
      },
    });
    const own = await call('get', `/organizations/jpice/manage/posts/${post.id}`, 'officer');
    expect((own.body as ManagedPost).gallery).toHaveLength(1);
    expect((own.body as ManagedPost).gallery[0]!.widths).toEqual([480]);
    await call('get', `/organizations/psme/manage/posts/${post.id}`, 'psmeOfficer').expect(404);
    await call('get', '/organizations/nope/page').expect(404);
    await call('get', '/organizations/nope/posts/rss.xml').expect(404);
  });

  it('filters the own list by status', async () => {
    await created(UPDATE);
    await created({ ...UPDATE, action: 'draft' });
    const drafts = await call('get', '/organizations/jpice/manage/posts?status=DRAFT', 'officer');
    expect((drafts.body as ManagedPostListResponse).items.map((p) => p.status)).toEqual(['DRAFT']);
  });

  it('marks edits of live posts only', async () => {
    const draft = await created({ ...UPDATE, action: 'draft' });
    const live = await created({ ...UPDATE, title: 'Live one' });
    const edit = (id: string) =>
      call('patch', `/organizations/jpice/posts/${id}`, 'officer').send({
        ...ACTING,
        title: 'Changed title',
        summary: 'Changed.',
      });
    await edit(draft.id).expect(200);
    await edit(live.id).expect(200);
    const rows = await db.orgPost.findMany({ where: { id: { in: [draft.id, live.id] } } });
    expect(rows.find((r) => r.id === draft.id)?.editedAt).toBeNull();
    expect(rows.find((r) => r.id === live.id)?.editedAt).not.toBeNull();
  });

  it('schedules a draft through publish, and refuses to unpublish a draft', async () => {
    const draft = await created({ ...UPDATE, action: 'draft' });
    const res = await call('post', `/organizations/jpice/posts/${draft.id}/publish`, 'officer').send({
      ...ACTING,
      publishAt: '2026-11-08T09:00:00+08:00',
    });
    expect((res.body as ManagedPost).status).toBe('SCHEDULED');
    const audit = await db.auditLog.findFirst({ where: { entityId: draft.id }, orderBy: { createdAt: 'desc' } });
    expect(audit?.metadata).toMatchObject({ change: 'schedule' });

    const other = await created({ ...UPDATE, action: 'draft' });
    await call('post', `/organizations/jpice/posts/${other.id}/unpublish`, 'officer')
      .send(ACTING)
      .expect(409);
  });

  it('still hides the post when the notification fails', async () => {
    const post = await created(UPDATE);
    notify.mockRejectedValueOnce(new Error('mail down'));
    await call('post', `/organizations/jpice/posts/${post.id}/hide`, 'governor')
      .send({ actingAs: 'Gov', reason: 'Wrong event photos' })
      .expect(204);
  });

  it('does not let the ISSC moderate an SBO while its CSC seat is filled', async () => {
    const page = await call('get', '/organizations/jpice/page', 'isscPresident');
    expect((page.body as OrganizationPage).viewer.canModerate).toBe(false);
    const csc = await call('get', '/organizations/csc-cea/page', 'isscPresident');
    expect((csc.body as OrganizationPage).viewer.canModerate).toBe(true);
  });

  it('refuses bytes that are not an image, and an empty body', async () => {
    const res = await call('post', '/organizations/jpice/post-images', 'officer')
      .set('Content-Type', 'image/png')
      .set(ACTING_AS_HEADER, 'Maria')
      .send(Buffer.from('not really a png'));
    expect(res.status).toBe(400);
    const empty = await call('post', '/organizations/jpice/post-images', 'officer')
      .set('Content-Type', 'image/png')
      .set(ACTING_AS_HEADER, 'Maria')
      .send(Buffer.alloc(0));
    expect(empty.status).toBe(400);
  });
});
