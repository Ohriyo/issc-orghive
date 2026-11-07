import express, { Router, type RequestHandler } from 'express';
import { LOGO_MIME_TYPES, POST_IMAGE_MAX_BYTES } from '@orghive/shared';
import { createOrgPostController } from '#src/controllers/org-post.controller';
import { publicCache, viewerCache } from '#src/middleware/public-cache';
import { createOrgGuards, optionalAuth, requireAuth } from '#src/middleware/require-auth';
import type { AccessService } from '#src/services/access.service';
import type { OrgPostService } from '#src/services/org-post.service';
import type { TokenService } from '#src/services/token.service';

export interface OrgPostsRouterDeps {
  posts: OrgPostService;
  access: AccessService;
  tokens: Pick<TokenService, 'verify'>;
  /** Where the web app lives, for the links in the RSS feed. */
  webOrigin: string;
}

const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
};

/**
 * Organization posts (docs/DOMAIN_RULES.md, "Organization posts"). Anyone reads live posts;
 * the organization's own account writes (requireOwnOrg); a governing body hides (the
 * service checks post-rules.ts, since the poster's own guard would refuse it).
 */
export function orgPostsRouter({ posts, access, tokens, webOrigin }: OrgPostsRouterDeps): Router {
  const router = Router();
  const controller = createOrgPostController(posts, webOrigin);
  const { requireOwnOrg, requireActiveOrg } = createOrgGuards(access);
  const auth = requireAuth(tokens);
  const own = [auth, requireOwnOrg, noStore];

  // Public reads. rss.xml is not a valid post slug, so it never shadows a post.
  router.get('/organizations/:slug/page', optionalAuth(tokens), viewerCache, controller.page);
  router.get('/organizations/:slug/posts', publicCache, controller.list);
  router.get('/organizations/:slug/posts/rss.xml', publicCache, controller.feed);
  router.get(
    '/organizations/:slug/posts/:postSlug',
    optionalAuth(tokens),
    viewerCache,
    controller.get,
  );

  // The own account: every status, and every write.
  router.get('/organizations/:slug/manage/posts', ...own, controller.listOwn);
  router.get('/organizations/:slug/manage/posts/:postId', ...own, controller.getOwn);
  // Small images only, as raw bytes; never through Multer or the JSON parser.
  router.post(
    '/organizations/:slug/post-images',
    ...own,
    requireActiveOrg,
    express.raw({ type: [...LOGO_MIME_TYPES], limit: POST_IMAGE_MAX_BYTES }),
    controller.uploadImage,
  );
  router.post('/organizations/:slug/posts', ...own, requireActiveOrg, controller.create);
  router.patch('/organizations/:slug/posts/:postId', ...own, controller.update);
  router.post(
    '/organizations/:slug/posts/:postId/publish',
    ...own,
    requireActiveOrg,
    controller.publish,
  );
  router.post('/organizations/:slug/posts/:postId/unpublish', ...own, controller.unpublish);
  router.delete('/organizations/:slug/posts/:postId', ...own, controller.remove);
  router.put('/organizations/:slug/highlights/pinned', ...own, controller.setPinned);

  // A governing body (post-rules.ts `moderationAuthority`, checked by the service).
  router.post('/organizations/:slug/posts/:postId/hide', auth, noStore, controller.hide);

  return router;
}
