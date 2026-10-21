import { get, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardEvent, SemesterKey } from '@orghive/shared';
import {
  createLeaderboardStream,
  STREAM_LIMITS,
  STREAM_RETRY_MS,
  type StreamLimits,
} from '#src/lib/leaderboard-stream';

const FIRST = { academicYear: '2026-2027', semester: 'first' as const };
const SECOND = { academicYear: '2026-2027', semester: 'second' as const };

const eventOf = (semester: SemesterKey, marker = 0): LeaderboardEvent => ({
  ...semester,
  latePoints: 0.5 + marker / 100,
  boards: { SBO: [], CSC: [] },
});

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });
  server = undefined;
});

function setup(limits: Partial<StreamLimits> = {}) {
  let marker = 0;
  const boards = vi.fn((semester: SemesterKey) => Promise.resolve(eventOf(semester, marker)));
  const logger = { warn: vi.fn() };
  const hub = createLeaderboardStream({ boards, logger, limits: { ...STREAM_LIMITS, ...limits } });
  const app = express();
  app.get('/stream/:semester', (req, res) => {
    hub.open(req, res, req.params.semester === 'second' ? SECOND : FIRST);
  });
  server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  return {
    hub,
    boards,
    logger,
    bump: () => (marker += 1),
    connect: (semester: 'first' | 'second' = 'first') => connect(port, semester),
  };
}

interface Connection {
  res: IncomingMessage;
  text: () => string;
  /** Waits until the stream has received `count` chunks matching `pattern`. */
  waitFor: (pattern: RegExp, count?: number) => Promise<void>;
  /** Settles when the server ends the stream (recorded from the start, so never missed). */
  ended: Promise<void>;
  close: () => void;
}

function connect(port: number, semester: string): Promise<Connection> {
  return new Promise((resolve, reject) => {
    const req = get(`http://127.0.0.1:${port}/stream/${semester}`, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      const ended = new Promise<void>((done) => res.on('end', done));
      resolve({
        res,
        ended,
        text: () => body,
        waitFor: (pattern, count = 1) =>
          vi.waitFor(
            () => {
              const found = body.match(new RegExp(pattern.source, 'g'))?.length ?? 0;
              if (found < count) throw new Error(`waiting for ${String(pattern)}`);
            },
            { timeout: 2000 },
          ),
        close: () => req.destroy(),
      });
    });
    req.on('error', reject);
  });
}

const standings = (event: LeaderboardEvent) =>
  `event: standings\ndata: ${JSON.stringify(event)}\n\n`;

describe('leaderboard stream', () => {
  it('opens an event stream and sends both boards at once', async () => {
    const { connect, boards } = setup();
    const stream = await connect();
    expect(stream.res.statusCode).toBe(200);
    expect(stream.res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(stream.res.headers['cache-control']).toBe('no-store, no-transform');
    expect(stream.res.headers['x-accel-buffering']).toBe('no');
    await stream.waitFor(/event: standings/);
    expect(stream.text()).toBe(`retry: ${STREAM_RETRY_MS}\n\n${standings(eventOf(FIRST))}`);
    expect(boards).toHaveBeenCalledWith(FIRST);
  });

  it('sends a change to the streams of that semester only, building the boards once', async () => {
    const { connect, hub, boards, bump } = setup();
    const a = await connect('first');
    const b = await connect('first');
    const other = await connect('second');
    await Promise.all([a, b, other].map((s) => s.waitFor(/event: standings/)));
    boards.mockClear();

    bump();
    await hub.changed(FIRST);
    expect(boards).toHaveBeenCalledOnce();
    await a.waitFor(/event: standings/, 2);
    await b.waitFor(/event: standings/, 2);
    expect(a.text()).toContain(standings(eventOf(FIRST, 1)));
    expect(other.text().match(/event: standings/g)).toHaveLength(1);
  });

  it('reads the boards once for streams that open together', async () => {
    const { connect, boards } = setup();
    // A read that takes a moment, as the database does: the three arrive while it runs.
    boards.mockImplementation(
      (semester) => new Promise((resolve) => setTimeout(() => resolve(eventOf(semester)), 100)),
    );
    const streams = await Promise.all([connect(), connect(), connect()]);
    await Promise.all(streams.map((s) => s.waitFor(/event: standings/)));
    expect(boards).toHaveBeenCalledOnce();
    // Later, a fresh read: the shared one is not cached.
    const late = await connect();
    await late.waitFor(/event: standings/);
    expect(boards).toHaveBeenCalledTimes(2);
  });

  it('does nothing for a semester nobody watches', async () => {
    const { hub, boards } = setup();
    await hub.changed(SECOND);
    expect(boards).not.toHaveBeenCalled();
  });

  it('writes a heartbeat comment to keep idle streams open', async () => {
    const { connect } = setup({ heartbeatMs: 20 });
    const stream = await connect();
    await stream.waitFor(/: ping\n\n/, 2);
  });

  it('refuses a stream past the per-IP limit with 429, and counts a closed one out', async () => {
    const { connect, hub } = setup({ perIp: 2 });
    const first = await connect();
    await connect();
    const refused = await connect();
    expect(refused.res.statusCode).toBe(429);
    expect(refused.res.headers['cache-control']).toBe('no-store');
    expect(hub.connections('127.0.0.1')).toBe(2);

    first.close();
    await vi.waitFor(() => expect(hub.connections()).toBe(1));
    expect((await connect()).res.statusCode).toBe(200);
  });

  it('refuses a stream past the instance limit', async () => {
    const { connect } = setup({ total: 1 });
    await connect();
    expect((await connect()).res.statusCode).toBe(429);
  });

  it('drops a client that cannot keep up; the browser reconnects or polls', async () => {
    const { connect, hub } = setup({ maxBufferedBytes: -1 });
    const stream = await connect();
    await stream.ended;
    await vi.waitFor(() => expect(hub.connections()).toBe(0));
  });

  it('ends the stream when the first boards cannot be read', async () => {
    const { connect, boards, logger } = setup();
    boards.mockRejectedValueOnce(new Error('db down'));
    const stream = await connect();
    await stream.ended;
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('keeps streams open when a change cannot be read', async () => {
    const { connect, hub, boards, logger } = setup();
    const stream = await connect();
    await stream.waitFor(/event: standings/);
    boards.mockRejectedValueOnce(new Error('db down'));
    await hub.changed(FIRST);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(hub.connections()).toBe(1);
  });

  it('ends every stream on shutdown', async () => {
    const { connect, hub } = setup();
    const streams = await Promise.all([connect(), connect('second')]);
    hub.closeAll();
    await Promise.all(streams.map((s) => s.ended));
    expect(hub.connections()).toBe(0);
  });
});
