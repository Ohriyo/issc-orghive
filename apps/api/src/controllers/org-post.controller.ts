import type { Request, RequestHandler, Response } from 'express';
import {
  actingAsRequestSchema,
  createPostRequestSchema,
  hidePostRequestSchema,
  managePostListQuerySchema,
  pinHighlightsRequestSchema,
  postIdParamsSchema,
  postListQuerySchema,
  postSlugParamsSchema,
  publishPostRequestSchema,
  slugParamsSchema,
  updatePostRequestSchema,
  type PostCard,
} from '@orghive/shared';
import { actingAsHeader, imageOf } from '#src/controllers/profile.controller';
import { authOf, maybeAuthOf, orgOf } from '#src/middleware/require-auth';
import type { Actor } from '#src/services/document.service';
import type { OrgPostService } from '#src/services/org-post.service';

function actorOf(req: Request, res: Response): Actor {
  return { userId: authOf(res).userId, ip: req.ip };
}

const xml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** RSS 2.0 for an organization's newest live posts; links point at the web app. */
export function rssOf(
  webOrigin: string,
  org: { slug: string; acronym: string; name: string },
  items: PostCard[],
): string {
  const base = webOrigin.replace(/\/+$/, '');
  const page = `${base}/orgs/${encodeURIComponent(org.slug)}/updates`;
  const entries = items
    .map((item) => {
      const link = `${page}/${encodeURIComponent(item.slug)}`;
      return [
        '<item>',
        `<title>${xml(item.title)}</title>`,
        `<link>${xml(link)}</link>`,
        `<guid isPermaLink="false">${xml(item.id)}</guid>`,
        `<pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>`,
        `<description>${xml(item.summary)}</description>`,
        '</item>',
      ].join('');
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<rss version="2.0"><channel>' +
    `<title>${xml(`${org.acronym} updates · Orghive`)}</title>` +
    `<link>${xml(page)}</link>` +
    `<description>${xml(`News from ${org.name}`)}</description>` +
    '<language>en</language>' +
    entries +
    '</channel></rss>'
  );
}

export function createOrgPostController(posts: OrgPostService, webOrigin: string) {
  const page: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    res.json(await posts.page(maybeAuthOf(res)?.userId, slug));
  };

  const list: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    res.json(await posts.list(slug, postListQuerySchema.parse(req.query)));
  };

  const get: RequestHandler = async (req, res) => {
    const { slug, postSlug } = postSlugParamsSchema.parse(req.params);
    res.json(await posts.get(maybeAuthOf(res)?.userId, slug, postSlug));
  };

  const feed: RequestHandler = async (req, res) => {
    const { slug } = slugParamsSchema.parse(req.params);
    const { organization, items } = await posts.feed(slug);
    res.type('application/rss+xml').send(rssOf(webOrigin, organization, items));
  };

  const listOwn: RequestHandler = async (req, res) => {
    res.json(await posts.listOwn(orgOf(res), managePostListQuerySchema.parse(req.query)));
  };

  const getOwn: RequestHandler = async (req, res) => {
    const { postId } = postIdParamsSchema.parse(req.params);
    res.json(await posts.getOwn(orgOf(res), postId));
  };

  const uploadImage: RequestHandler = async (req, res) => {
    const actingAs = actingAsHeader(req);
    res
      .status(201)
      .json(await posts.uploadImage(actorOf(req, res), orgOf(res), imageOf(req, 'image'), actingAs));
  };

  const create: RequestHandler = async (req, res) => {
    const body = createPostRequestSchema.parse(req.body);
    res.status(201).json(await posts.create(actorOf(req, res), orgOf(res), body));
  };

  const update: RequestHandler = async (req, res) => {
    const { postId } = postIdParamsSchema.parse(req.params);
    const body = updatePostRequestSchema.parse(req.body);
    res.json(await posts.update(actorOf(req, res), orgOf(res), postId, body));
  };

  const publish: RequestHandler = async (req, res) => {
    const { postId } = postIdParamsSchema.parse(req.params);
    const body = publishPostRequestSchema.parse(req.body);
    res.json(await posts.publish(actorOf(req, res), orgOf(res), postId, body));
  };

  const unpublish: RequestHandler = async (req, res) => {
    const { postId } = postIdParamsSchema.parse(req.params);
    const { actingAs } = actingAsRequestSchema.parse(req.body);
    res.json(await posts.unpublish(actorOf(req, res), orgOf(res), postId, actingAs));
  };

  const remove: RequestHandler = async (req, res) => {
    const { postId } = postIdParamsSchema.parse(req.params);
    const { actingAs } = actingAsRequestSchema.parse(req.body);
    await posts.remove(actorOf(req, res), orgOf(res), postId, actingAs);
    res.status(204).end();
  };

  const setPinned: RequestHandler = async (req, res) => {
    const { postIds, actingAs } = pinHighlightsRequestSchema.parse(req.body);
    await posts.setPinned(actorOf(req, res), orgOf(res), postIds, actingAs);
    res.status(204).end();
  };

  const hide: RequestHandler = async (req, res) => {
    const { slug, postId } = postIdParamsSchema.parse(req.params);
    const body = hidePostRequestSchema.parse(req.body);
    await posts.hide(actorOf(req, res), slug, postId, body);
    res.status(204).end();
  };

  return {
    page,
    list,
    get,
    feed,
    listOwn,
    getOwn,
    uploadImage,
    create,
    update,
    publish,
    unpublish,
    remove,
    setPinned,
    hide,
  };
}
