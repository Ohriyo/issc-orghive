/**
 * Load test of the live leaderboard (docs/LEADERBOARD_PHASES.md, Phase 4.4).
 *
 *   pnpm --filter api load:sse [--connections 500] [--ips 20] [--port 4200] [--no-heartbeat]
 *
 * Starts its own API instance (the database and Redis from apps/api/.env, `docker compose
 * up -d` first) and opens many GET /api/v1/leaderboard/stream connections, as browsers do.
 * The per-IP limit (50) would refuse them from one address, so the instance trusts one proxy
 * hop (TRUST_PROXY=1, this instance only) and each connection names one of `--ips` client
 * addresses in X-Forwarded-For, as Nginx would. It reports the API's memory before, with the
 * streams open and after they close; how long the first boards and a change took to reach
 * every stream; the heartbeat; and that the per-IP limit still answers 429.
 */
import { execFileSync, spawn } from 'node:child_process';
import { get, type ClientRequest, type IncomingMessage } from 'node:http';
import { Agent } from 'node:http';
import { parseArgs } from 'node:util';
import { currentSemesterKey } from '@orghive/shared';
import { createRedis } from '#src/lib/cache';
import { LEADERBOARD_CHANNEL } from '#src/lib/leaderboard-events';
import { STREAM_LIMITS } from '#src/lib/leaderboard-stream';

const { values } = parseArgs({
  options: {
    connections: { type: 'string', default: '500' },
    ips: { type: 'string', default: '20' },
    port: { type: 'string', default: '4200' },
    'no-heartbeat': { type: 'boolean', default: false },
  },
});
const CONNECTIONS = Number(values.connections);
const IPS = Number(values.ips);
const PORT = Number(values.port);
const BASE = `http://127.0.0.1:${PORT}`;

if (Math.ceil(CONNECTIONS / IPS) > STREAM_LIMITS.perIp) {
  console.error(`${CONNECTIONS} streams over ${IPS} addresses exceed ${STREAM_LIMITS.perIp} per IP`);
  process.exit(1);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The API process's resident memory (Windows: working set), in bytes. */
function rssOf(pid: number): number {
  if (process.platform === 'win32') {
    const line = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
    });
    const kb = /"([\d,.\s]+) K"/.exec(line)?.[1]?.replace(/[^\d]/g, '');
    if (!kb) throw new Error(`no memory figure for PID ${pid}: ${line}`);
    return Number(kb) * 1024;
  }
  return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' })) * 1024;
}

/** The median of three samples a second apart, to smooth the collector's swings. */
async function settledRss(pid: number): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    samples.push(rssOf(pid));
    await sleep(1000);
  }
  return samples.sort((a, b) => a - b)[1]!;
}

interface Stream {
  req: ClientRequest;
  standings: number;
  pings: number;
  firstAt: number | null;
  secondAt: number | null;
}

const agent = new Agent({ keepAlive: false, maxSockets: Infinity });

function open(ip: string): Promise<{ stream: Stream; status: number }> {
  return new Promise((resolve, reject) => {
    const stream: Stream = { req: null!, standings: 0, pings: 0, firstAt: null, secondAt: null };
    stream.req = get(
      `${BASE}/api/v1/leaderboard/stream`,
      { agent, headers: { 'X-Forwarded-For': ip, Accept: 'text/event-stream' } },
      (res: IncomingMessage) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          stream.pings += chunk.split(': ping').length - 1;
          const events = chunk.split('event: standings').length - 1;
          for (let i = 0; i < events; i += 1) {
            stream.standings += 1;
            if (stream.standings === 1) stream.firstAt = performance.now();
            if (stream.standings === 2) stream.secondAt = performance.now();
          }
        });
        resolve({ stream, status: res.statusCode ?? 0 });
      },
    );
    stream.req.on('error', reject);
  });
}

async function waitFor(check: () => boolean, timeoutMs: number, what: string) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(50);
  }
}

const api = spawn(
  process.execPath,
  ['--import', 'tsx', '--env-file-if-exists=.env', 'src/server.ts'],
  {
    // Set here, so --env-file leaves them alone: this instance only.
    env: { ...process.env, PORT: String(PORT), TRUST_PROXY: '1', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
const report: [string, string][] = [];

try {
  const healthDeadline = Date.now() + 60_000;
  for (;;) {
    const ok = await fetch(`${BASE}/health`).then((r) => r.ok, () => false);
    if (ok) break;
    if (Date.now() > healthDeadline) throw new Error('the API did not start');
    await sleep(500);
  }

  // Warm up: load the routes and the boards once, then let the process settle.
  await fetch(`${BASE}/api/v1/leaderboard?type=SBO`);
  const warm = await open('10.255.0.1');
  await waitFor(() => warm.stream.standings > 0, 10_000, 'the warm-up stream');
  warm.stream.req.destroy();

  // The per-IP limit, first, while the instance has room (at its total limit every stream
  // is refused anyway): one more than allowed from a single address.
  const capIp = '10.254.0.1';
  const capped = await Promise.all(
    Array.from({ length: STREAM_LIMITS.perIp + 1 }, () => open(capIp)),
  );
  const capStatuses = capped.map((c) => c.status);
  for (const c of capped) c.stream.req.destroy();
  await sleep(3000);
  const before = await settledRss(api.pid!);

  // Open every stream at once, as a crowd arriving.
  const started = performance.now();
  const opened = await Promise.all(
    // Each simulated client is one address: CONNECTIONS / IPS streams share it.
    Array.from({ length: CONNECTIONS }, (_, i) => open(`10.0.${i % IPS}.1`)),
  );
  const refused = opened.filter((o) => o.status !== 200).length;
  const streams = opened.map((o) => o.stream);
  await waitFor(() => streams.every((s) => s.standings >= 1), 60_000, 'every first board');
  const firstBoards = Math.max(...streams.map((s) => s.firstAt!)) - started;
  await sleep(2000);
  const open500 = await settledRss(api.pid!);

  // A change: what the worker publishes after a recompute.
  const redis = createRedis(process.env.REDIS_URL!);
  const published = performance.now();
  await redis.publish(LEADERBOARD_CHANNEL, JSON.stringify(currentSemesterKey(new Date())));
  await waitFor(() => streams.every((s) => s.standings >= 2), 30_000, 'the change on every stream');
  const fanOut = Math.max(...streams.map((s) => s.secondAt!)) - published;
  redis.disconnect();

  let heartbeat = 'skipped';
  if (!values['no-heartbeat']) {
    await waitFor(
      () => streams.every((s) => s.pings >= 1),
      STREAM_LIMITS.heartbeatMs + 10_000,
      'a heartbeat on every stream',
    );
    heartbeat = `every stream got one within ${STREAM_LIMITS.heartbeatMs / 1000} s`;
  }


  for (const s of streams) s.req.destroy();
  await sleep(5000);
  const after = await settledRss(api.pid!);

  report.push(
    ['Streams opened', `${CONNECTIONS - refused} of ${CONNECTIONS} (${IPS} client IPs)`],
    ['API memory before', mb(before)],
    [`API memory with ${CONNECTIONS} streams open`, mb(open500)],
    ['Per stream', `${((open500 - before) / CONNECTIONS / 1024).toFixed(1)} KB`],
    ['API memory after they closed', mb(after)],
    ['All first boards received in', `${Math.round(firstBoards)} ms`],
    [`A change reached all ${CONNECTIONS} in`, `${Math.round(fanOut)} ms`],
    ['Heartbeat', heartbeat],
    [
      `Per-IP limit (${STREAM_LIMITS.perIp + 1} from one IP)`,
      `${capStatuses.filter((s) => s === 200).length} opened, ${capStatuses.filter((s) => s === 429).length} refused with 429`,
    ],
  );
  console.log(`\nSSE load test, ${new Date().toISOString()}, Node ${process.version}, ${process.platform}`);
  const width = Math.max(...report.map(([k]) => k.length));
  for (const [k, v] of report) console.log(`  ${k.padEnd(width)}  ${v}`);
  // They arrive together, so any one of them may be the one refused.
  const capOk =
    capStatuses.filter((s) => s === 429).length === 1 &&
    capStatuses.filter((s) => s === 200).length === STREAM_LIMITS.perIp;
  process.exitCode = refused === 0 && capOk ? 0 : 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  agent.destroy();
  api.kill();
}
