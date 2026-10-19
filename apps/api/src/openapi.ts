import { createDocument } from 'zod-openapi';
import {
  apiErrorBodySchema,
  collegeDetailSchema,
  collegeListResponseSchema,
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
    },
  });
}
