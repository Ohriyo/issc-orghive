import { statfs } from 'node:fs/promises';
import { connect } from 'node:net';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { Redis } from 'ioredis';
import nodemailer from 'nodemailer';
import type { Config } from '#src/config';

/*
 * Small probes of the services Orghive depends on, for /system/health and the alert check.
 * Each throws when its service cannot be reached; the health service times them out.
 */

/** The worker writes this every WORKER_HEARTBEAT_MS; the API reads its age. */
export const WORKER_HEARTBEAT_KEY = 'system:worker:heartbeat';
export const WORKER_HEARTBEAT_MS = 30_000;
/** Outlives a few missed beats, then disappears, so a stopped worker reads as missing. */
export const WORKER_HEARTBEAT_TTL_SECONDS = 10 * 60;

export interface ClamavVersion {
  /** e.g. "ClamAV 1.4.6" */
  engine: string;
  /** The signature database's date, or null when clamd did not say. */
  signaturesAt: Date | null;
}

/**
 * Parses clamd's VERSION reply, "ClamAV 1.4.6/28180/Wed Nov 11 06:24:27 2026". clamd prints
 * the database date in its own time zone; the official image runs in UTC.
 */
export function parseClamavVersion(raw: string): ClamavVersion {
  const text = raw.replaceAll('\0', '').trim();
  const [engine = text, , date] = text.split('/');
  const parsed = date ? Date.parse(`${date.trim()} UTC`) : NaN;
  return { engine: engine.trim(), signaturesAt: Number.isNaN(parsed) ? null : new Date(parsed) };
}

export function probeClamav(host: string, port: number, timeoutMs = 3_000): Promise<ClamavVersion> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let reply = '';
    const fail = (err: Error) => {
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error('clamd timed out')));
    socket.on('error', fail);
    socket.on('connect', () => socket.write('zVERSION\0'));
    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8');
      if (reply.includes('\0')) {
        socket.destroy();
        resolve(parseClamavVersion(reply));
      }
    });
  });
}

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
  /** 0 to 1. */
  usedRatio: number;
}

/** The disk holding `path` (the API's working directory by default). */
export async function probeDisk(path = process.cwd()): Promise<DiskUsage> {
  const stats = await statfs(path);
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bavail * stats.bsize;
  return {
    totalBytes,
    freeBytes,
    usedRatio: totalBytes > 0 ? (totalBytes - freeBytes) / totalBytes : 0,
  };
}

/** Parses `INFO` output into its key/value pairs. */
export function parseRedisInfo(info: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of info.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0 && !line.startsWith('#')) fields[line.slice(0, at)] = line.slice(at + 1).trim();
  }
  return fields;
}

export interface RedisStats {
  latencyMs: number;
  usedMemoryBytes: number;
  /** 0 when Redis has no limit. */
  maxMemoryBytes: number;
}

export async function probeRedis(redis: Redis): Promise<RedisStats> {
  const started = performance.now();
  await redis.ping();
  const latencyMs = performance.now() - started;
  const memory = parseRedisInfo(await redis.info('memory'));
  return {
    latencyMs,
    usedMemoryBytes: Number(memory.used_memory ?? 0),
    maxMemoryBytes: Number(memory.maxmemory ?? 0),
  };
}

/** The worker's last heartbeat, or null when it has none (stopped, or never started). */
export async function readWorkerHeartbeat(redis: Redis): Promise<Date | null> {
  const value = await redis.get(WORKER_HEARTBEAT_KEY);
  const at = value ? Date.parse(value) : NaN;
  return Number.isNaN(at) ? null : new Date(at);
}

export async function writeWorkerHeartbeat(redis: Redis, at: Date): Promise<void> {
  await redis.set(WORKER_HEARTBEAT_KEY, at.toISOString(), 'EX', WORKER_HEARTBEAT_TTL_SECONDS);
}

type StorageConfig = Pick<
  Config,
  'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY' | 'S3_FORCE_PATH_STYLE'
>;

/** Whether the bucket answers (HeadBucket: no object is read). */
export function createStorageProbe(config: StorageConfig): () => Promise<void> {
  const s3 = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
  return async () => {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  };
}

type SmtpConfig = Pick<
  Config,
  'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASS'
>;

/** Whether the mail relay accepts a connection (and the login, when one is set). Sends nothing. */
export function createSmtpProbe(config: SmtpConfig): () => Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    connectionTimeout: 3_000,
    greetingTimeout: 3_000,
    ...(config.SMTP_USER && { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS } }),
  });
  return async () => {
    await transport.verify();
  };
}
