import express from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiErrorBodySchema } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import { createErrorHandler } from '#src/middleware/error-handler';
import { buildTestApp } from './helpers';

function appThatThrows(err: unknown) {
  const app = express();
  app.use(express.json());
  app.get('/boom', () => {
    throw err;
  });
  app.post('/echo', (req, res) => {
    res.json(req.body);
  });
  app.use(createErrorHandler(pino({ level: 'silent' })));
  return app;
}

describe('error handler', () => {
  it('returns 404 NOT_FOUND for unknown routes', async () => {
    const res = await request(buildTestApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('NOT_FOUND');
  });

  it('maps AppError to its status and code', async () => {
    const res = await request(appThatThrows(AppError.forbidden())).get('/boom');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: { code: 'FORBIDDEN', message: 'You do not have permission to do this' },
    });
  });

  it('maps ZodError to 400 VALIDATION_ERROR', async () => {
    const parsed = z.object({ name: z.string() }).safeParse({});
    const res = await request(appThatThrows(parsed.error)).get('/boom');
    expect(res.status).toBe(400);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('maps malformed JSON to 400 INVALID_JSON', async () => {
    const res = await request(appThatThrows(null))
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('INVALID_JSON');
  });

  it('hides unexpected errors behind a generic 500', async () => {
    const res = await request(appThatThrows(new Error('db password is hunter2'))).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' },
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});
