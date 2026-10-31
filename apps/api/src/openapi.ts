import { createDocument } from 'zod-openapi';
import {
  demoStatusSchema,
  apiErrorBodySchema,
  collegeDetailSchema,
  collegeListResponseSchema,
  constitutionResponseSchema,
  handbookEditionListSchema,
  handbookResponseSchema,
  handbookSearchQuerySchema,
  handbookSearchResponseSchema,
  handbookYearParamsSchema,
  leaderboardEventSchema,
  leaderboardQuerySchema,
  leaderboardResponseSchema,
  leaderboardStreamQuerySchema,
  organizationDetailSchema,
  searchQuerySchema,
  searchResponseSchema,
  slugParamsSchema,
} from '@orghive/shared';

const json = <T>(schema: T) => ({ 'application/json': { schema } });

const publicCacheHeaders = {
  'Cache-Control': {
    description: 'public, max-age=60, stale-while-revalidate=300',
    schema: { type: 'string' as const },
  },
  ETag: {
    description: 'Weak ETag; send it back as If-None-Match for a 304',
    schema: { type: 'string' as const },
  },
};

const errors = {
  '400': { description: 'Malformed slug', content: json(apiErrorBodySchema) },
  '404': { description: 'Unknown slug', content: json(apiErrorBodySchema) },
};

/** OpenAPI 3.1 document generated from the shared Zod schemas. */
export function createOpenApiDocument(): ReturnType<typeof createDocument> {
  return createDocument({
    openapi: '3.1.0',
    info: { title: 'Orghive API', version: '1.0.0' },
    servers: [{ url: '/api/v1' }],
    paths: {
      '/colleges': {
        get: {
          summary: 'List colleges with their CSC',
          tags: ['Public'],
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(collegeListResponseSchema),
            },
            '304': { description: 'Not modified (ETag matched)' },
          },
        },
      },
      '/colleges/{slug}': {
        get: {
          summary: 'A college with its CSC and SBOs',
          tags: ['Public'],
          requestParams: { path: slugParamsSchema },
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(collegeDetailSchema),
            },
            '304': { description: 'Not modified (ETag matched)' },
            ...errors,
          },
        },
      },
      '/organizations/{slug}': {
        get: {
          summary: 'An organization profile (ISSC, CSC or SBO)',
          tags: ['Public'],
          requestParams: { path: slugParamsSchema },
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(organizationDetailSchema),
            },
            '304': { description: 'Not modified (ETag matched)' },
            ...errors,
          },
        },
      },
      '/organizations/{slug}/constitution': {
        get: {
          summary: 'An organization’s Constitution & By-laws and its amendment history',
          description:
            'Always public and view-only: open a version in the watermarked viewer (GET /documents/{id}/viewer?versionId=). Null until one has passed the virus scan.',
          tags: ['Public'],
          requestParams: { path: slugParamsSchema },
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(constitutionResponseSchema),
            },
            '304': { description: 'Not modified (ETag matched)' },
            ...errors,
          },
        },
      },
      '/handbook': {
        get: {
          summary: 'The current Student Handbook edition (null before one is published)',
          description:
            'Always public and view-only: read its pages in the watermarked viewer (GET /documents/{documentId}/viewer).',
          tags: ['Public'],
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(handbookResponseSchema),
            },
          },
        },
      },
      '/handbook/editions': {
        get: {
          summary: 'Every published Student Handbook edition, newest year first',
          tags: ['Public'],
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(handbookEditionListSchema),
            },
          },
        },
      },
      '/handbook/{year}': {
        get: {
          summary: 'One academic year’s Student Handbook edition',
          tags: ['Public'],
          requestParams: { path: handbookYearParamsSchema },
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(handbookResponseSchema),
            },
            '404': { description: 'No edition for that year', content: json(apiErrorBodySchema) },
          },
        },
      },
      '/handbook/{year}/search': {
        get: {
          summary: 'Pages of an edition matching the words (by prefix), best first',
          description: 'GET /handbook/search searches the current edition the same way.',
          tags: ['Public'],
          requestParams: { path: handbookYearParamsSchema, query: handbookSearchQuerySchema },
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(handbookSearchResponseSchema),
            },
            '404': { description: 'No edition for that year', content: json(apiErrorBodySchema) },
          },
        },
      },
      '/search': {
        get: {
          summary: 'Full-text search of every Paperworks document the caller may see',
          description:
            'Ranks title, then tags and description, then the text of the file. Signed-out results are cached for 5 minutes; signed-in results are private.',
          tags: ['Public'],
          requestParams: { query: searchQuerySchema },
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(searchResponseSchema),
            },
            '304': { description: 'Not modified (ETag matched)' },
            '400': { description: 'Invalid query', content: json(apiErrorBodySchema) },
          },
        },
      },
      '/leaderboard': {
        get: {
          summary: 'One leaderboard (SBO or CSC) of a semester',
          description:
            'Ranked by points, then net profit, then the earliest last completion (spec 5E). Without academicYear and semester, the current semester in Manila. Public fields only (spec 5F).',
          tags: ['Public'],
          requestParams: { query: leaderboardQuerySchema },
          responses: {
            '200': {
              description: 'OK',
              headers: {
                ...publicCacheHeaders,
                'Cache-Control': {
                  description: 'public, max-age=15',
                  schema: { type: 'string' as const },
                },
              },
              content: json(leaderboardResponseSchema),
            },
            '304': { description: 'Not modified (ETag matched)' },
            '400': { description: 'Invalid query', content: json(apiErrorBodySchema) },
          },
        },
      },
      '/leaderboard/stream': {
        get: {
          summary: 'Both leaderboards of a semester, live (Server-Sent Events)',
          description:
            'Sends a `standings` event with both boards on connect and whenever they change, and a comment every 25 s. Refused with 429 past the connection limits; poll GET /leaderboard instead.',
          tags: ['Public'],
          requestParams: { query: leaderboardStreamQuerySchema },
          responses: {
            '200': {
              description: 'An event stream; each `standings` event carries this JSON',
              content: { 'text/event-stream': { schema: leaderboardEventSchema } },
            },
            '400': { description: 'Invalid query', content: json(apiErrorBodySchema) },
            '429': { description: 'Too many open streams', content: json(apiErrorBodySchema) },
          },
        },
      },
      '/demo-status': {
        get: {
          summary: 'Organizations whose public pages show demo data ("Sample data" chip)',
          tags: ['Public'],
          responses: {
            '200': {
              description: 'OK',
              headers: publicCacheHeaders,
              content: json(demoStatusSchema),
            },
            '304': { description: 'Not modified (ETag matched)' },
          },
        },
      },
    },
  });
}
