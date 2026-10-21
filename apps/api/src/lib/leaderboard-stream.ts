import type { Request, Response } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import {
  ErrorCode,
  LEADERBOARD_STANDINGS_EVENT,
  type LeaderboardEvent,
  type SemesterKey,
} from '@orghive/shared';
import type { Logger } from '#src/logger';

export interface StreamLimits {
  /**
   * Open streams per client IP on one API instance. Generous: most of a campus can share
   * one IP. Anyone over it is refused (429) and the web app polls instead.
   */
  perIp: number;
  /** Open streams on one API instance. */
  total: number;
  /** A comment line this often keeps proxies and browsers from closing an idle stream. */
  heartbeatMs: number;
  /** A client this far behind (bytes not yet sent) is dropped; it reconnects or polls. */
  maxBufferedBytes: number;
}

export const STREAM_LIMITS: StreamLimits = {
  perIp: 50,
  total: 2000,
  heartbeatMs: 25_000,
  maxBufferedBytes: 1024 * 1024,
};

/** How long the browser waits before reconnecting a dropped stream (the SSE `retry`). */
export const STREAM_RETRY_MS = 5_000;

interface Client {
  res: Response;
  ip: string;
  semester: string;
}

const semesterId = ({ academicYear, semester }: SemesterKey) => `${academicYear}:${semester}`;

const frame = (data: LeaderboardEvent) =>
  `event: ${LEADERBOARD_STANDINGS_EVENT}\ndata: ${JSON.stringify(data)}\n\n`;

export interface LeaderboardStreamDeps {
  /** Both public boards of a semester (the public leaderboard service). */
  boards: (semester: SemesterKey) => Promise<LeaderboardEvent>;
  logger: Pick<Logger, 'warn'>;
  limits?: StreamLimits;
}

/**
 * GET /leaderboard/stream (docs/LEADERBOARD_PHASES.md, Phase 2): Server-Sent Events, grouped
 * by semester. A new stream gets both boards at once; `changed` (from Redis pub/sub, so
 * every API instance hears it) builds the boards once and sends them to that semester's
 * streams. One timer writes the heartbeat to all of them.
 */
export function createLeaderboardStream({
  boards,
  logger,
  limits = STREAM_LIMITS,
}: LeaderboardStreamDeps) {
  const bySemester = new Map<string, Set<Client>>();
  const perIp = new Map<string, number>();
  let total = 0;
  let heartbeat: NodeJS.Timeout | null = null;

  function send(client: Client, chunk: string): void {
    if (client.res.writableEnded) return;
    if (client.res.writableLength > limits.maxBufferedBytes) {
      client.res.end();
      return;
    }
    client.res.write(chunk);
  }

  function each(fn: (client: Client) => void): void {
    for (const clients of bySemester.values()) for (const client of clients) fn(client);
  }

  function startHeartbeat(): void {
    if (heartbeat) return;
    heartbeat = setInterval(() => each((client) => send(client, ': ping\n\n')), limits.heartbeatMs);
    heartbeat.unref();
  }

  // Streams that open together (a link shared in a group chat, the homepage after a class)
  // share one read of the boards: the load test showed 500 separate reads took 3 s.
  const opening = new Map<string, Promise<string>>();
  function openingFrame(semester: SemesterKey): Promise<string> {
    const id = semesterId(semester);
    let pending = opening.get(id);
    if (!pending) {
      pending = boards(semester)
        .then(frame)
        .finally(() => opening.delete(id));
      opening.set(id, pending);
    }
    return pending;
  }

  function remove(client: Client): void {
    const clients = bySemester.get(client.semester);
    if (!clients?.delete(client)) return;
    if (clients.size === 0) bySemester.delete(client.semester);
    total -= 1;
    const count = (perIp.get(client.ip) ?? 1) - 1;
    if (count > 0) perIp.set(client.ip, count);
    else perIp.delete(client.ip);
    if (total === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  return {
    /** Opens a stream, or answers 429 when the IP or this instance is at its limit. */
    open(req: Request, res: Response, semester: SemesterKey): void {
      const ip = ipKeyGenerator(req.ip ?? 'unknown');
      if (total >= limits.total || (perIp.get(ip) ?? 0) >= limits.perIp) {
        res
          .status(429)
          .set('Cache-Control', 'no-store')
          .json({
            error: {
              code: ErrorCode.RATE_LIMITED,
              message: 'Too many live connections. The leaderboard will refresh every minute.',
            },
          });
        return;
      }

      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        // Nginx and similar proxies pass events through instead of buffering them.
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write(`retry: ${STREAM_RETRY_MS}\n\n`);

      const client: Client = { res, ip, semester: semesterId(semester) };
      let clients = bySemester.get(client.semester);
      if (!clients) bySemester.set(client.semester, (clients = new Set()));
      clients.add(client);
      total += 1;
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      startHeartbeat();
      // The response closes when the browser goes away and when the server ends it.
      res.on('close', () => remove(client));

      openingFrame(semester).then(
        (chunk) => send(client, chunk),
        (err: unknown) => {
          logger.warn({ err }, 'Leaderboard stream could not send the first boards');
          res.end();
        },
      );
    },

    /** A semester's standings changed: its streams get both boards. */
    async changed(semester: SemesterKey): Promise<void> {
      const clients = bySemester.get(semesterId(semester));
      if (!clients || clients.size === 0) return;
      let chunk: string;
      try {
        chunk = frame(await boards(semester));
      } catch (err) {
        logger.warn({ err, semester }, 'Leaderboard change could not be sent');
        return;
      }
      for (const client of clients) send(client, chunk);
    },

    /** Open streams: in total, and of one IP (as the cap counts it). */
    connections(ip?: string): number {
      return ip === undefined ? total : (perIp.get(ipKeyGenerator(ip)) ?? 0);
    },

    /** Ends every stream (shutdown); browsers reconnect to another instance. */
    closeAll(): void {
      each((client) => client.res.end());
      bySemester.clear();
      perIp.clear();
      total = 0;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    },
  };
}

export type LeaderboardStream = ReturnType<typeof createLeaderboardStream>;
