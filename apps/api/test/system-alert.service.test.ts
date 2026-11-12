import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import type { AlertKind } from '@orghive/shared';
import { memoryMailer } from '#src/lib/mailer';
import type { AlertRow } from '#src/repositories/system-alert.repository';
import {
  createSystemAlertService,
  type SystemAlertServiceDeps,
} from '#src/services/system-alert.service';

const NOW = new Date('2026-11-11T12:00:00Z');
const logger = pino({ level: 'silent' });

/** The alert table in memory, with the same one-open-per-kind rule as the database. */
function memoryAlerts(seed: (AlertRow & { resolvedAt?: Date | null })[] = []) {
  const rows = seed.map((r) => ({ resolvedAt: null as Date | null, ...r }));
  let next = 1;
  const repo: SystemAlertServiceDeps['alerts'] = {
    listOpen: () => Promise.resolve(rows.filter((r) => !r.resolvedAt)),
    open(kind, message, at) {
      if (rows.some((r) => r.kind === kind && !r.resolvedAt)) return Promise.resolve(null);
      const row = { id: `a${next++}`, kind, message, openedAt: at, notifiedAt: null, resolvedAt: null };
      rows.push(row);
      return Promise.resolve(row);
    },
    updateMessage(kind, message) {
      for (const r of rows) if (r.kind === kind && !r.resolvedAt) r.message = message;
      return Promise.resolve();
    },
    resolve(kind, at) {
      let count = 0;
      for (const r of rows) {
        if (r.kind === kind && !r.resolvedAt) {
          r.resolvedAt = at;
          count += 1;
        }
      }
      return Promise.resolve(count);
    },
    lastNotifiedAt(kind) {
      const times = rows
        .filter((r) => r.kind === kind && r.notifiedAt)
        .map((r) => r.notifiedAt!.getTime());
      return Promise.resolve(times.length ? new Date(Math.max(...times)) : null);
    },
    claimNotification(id, at) {
      const row = rows.find((r) => r.id === id);
      if (!row || row.notifiedAt) return Promise.resolve(false);
      row.notifiedAt = at;
      return Promise.resolve(true);
    },
  };
  return { repo, rows };
}

function build(over: Partial<SystemAlertServiceDeps> = {}, alerts = memoryAlerts()) {
  const mailer = memoryMailer();
  const service = createSystemAlertService({
    alerts: alerts.repo,
    metrics: { traffic: () => Promise.resolve({ requests: 400, serverErrors: 1, p95Ms: 200 }) },
    probes: {
      workerHeartbeat: () => Promise.resolve(new Date(NOW.getTime() - 15_000)),
      diskUsedRatio: () => Promise.resolve(0.5),
      clamavSignaturesAt: () => Promise.resolve(new Date(NOW.getTime() - 3_600_000)),
    },
    settings: { alertCooldownMinutes: () => Promise.resolve(30) },
    superAdmins: { activeSuperAdminEmails: () => Promise.resolve(['dev@nwssu.test', 'ops@nwssu.test']) },
    mailer,
    logger,
    webOrigin: 'http://localhost:5173',
    now: () => NOW,
    ...over,
  });
  return { service, mailer, rows: alerts.rows };
}

const fullDisk = { diskUsedRatio: () => Promise.resolve(0.92) };
const probes = (over: Partial<SystemAlertServiceDeps['probes']>): SystemAlertServiceDeps['probes'] => ({
  workerHeartbeat: () => Promise.resolve(new Date(NOW.getTime() - 15_000)),
  diskUsedRatio: () => Promise.resolve(0.5),
  clamavSignaturesAt: () => Promise.resolve(new Date(NOW.getTime() - 3_600_000)),
  ...over,
});

describe('system alerts', () => {
  it('opens nothing and emails nobody when all is well', async () => {
    const { service, mailer } = build();
    expect(await service.evaluate()).toEqual([]);
    expect(mailer.sent).toEqual([]);
    expect((await service.listOpen()).alerts).toEqual([]);
  });

  it('opens an alert, emails every super admin once, and keeps it open', async () => {
    const { service, mailer } = build({ probes: probes(fullDisk) });
    expect(await service.evaluate()).toEqual(['disk_full']);
    expect(mailer.sent.map((m) => m.to)).toEqual(['dev@nwssu.test', 'ops@nwssu.test']);
    expect(mailer.sent[0]!.subject).toBe('Orghive alert: The disk is almost full');
    expect(mailer.sent[0]!.text).toContain('http://localhost:5173/system/health');

    // Still full a minute later: no second email.
    await service.evaluate();
    expect(mailer.sent).toHaveLength(2);
    const { alerts } = await service.listOpen();
    expect(alerts).toEqual([expect.objectContaining({ kind: 'disk_full', message: 'The disk is 92% full.' })]);
  });

  it('resolves an alert once its condition clears', async () => {
    const alerts = memoryAlerts([
      { id: 'w1', kind: 'worker_down', message: 'down', openedAt: NOW, notifiedAt: NOW },
    ]);
    const { service } = build({}, alerts);
    await service.evaluate();
    expect(alerts.rows[0]!.resolvedAt).toEqual(NOW);
  });

  it('does not email the same kind again within the cooldown', async () => {
    const alerts = memoryAlerts([
      {
        id: 'old',
        kind: 'disk_full',
        message: 'full',
        openedAt: new Date(NOW.getTime() - 20 * 60_000),
        notifiedAt: new Date(NOW.getTime() - 20 * 60_000),
        resolvedAt: new Date(NOW.getTime() - 10 * 60_000),
      },
    ]);
    const { service, mailer } = build({ probes: probes(fullDisk) }, alerts);
    expect(await service.evaluate()).toEqual(['disk_full']);
    expect(mailer.sent).toEqual([]);
  });

  it('opens one alert and one email even when two instances race', async () => {
    const alerts = memoryAlerts();
    const a = build({ probes: probes(fullDisk) }, alerts);
    const b = build({ probes: probes(fullDisk) }, alerts);
    await Promise.all([a.service.evaluate(), b.service.evaluate()]);
    expect(alerts.rows).toHaveLength(1);
    expect(a.mailer.sent.length + b.mailer.sent.length).toBe(2);
  });

  it('leaves alerts as they are when their probe fails', async () => {
    const seeded = (kind: AlertKind) => ({ id: kind, kind, message: kind, openedAt: NOW, notifiedAt: NOW });
    const alerts = memoryAlerts([seeded('worker_down'), seeded('error_rate'), seeded('disk_full')]);
    const fail = () => Promise.reject(new Error('unreachable'));
    const { service } = build(
      {
        metrics: { traffic: fail },
        probes: probes({ workerHeartbeat: fail, diskUsedRatio: fail, clamavSignaturesAt: fail }),
      },
      alerts,
    );
    expect(await service.evaluate()).toEqual([]);
    expect(alerts.rows.every((r) => r.resolvedAt === null)).toBe(true);
  });

  it('keeps an open alert’s message current', async () => {
    const alerts = memoryAlerts([
      { id: 'd', kind: 'disk_full', message: 'The disk is 86% full.', openedAt: NOW, notifiedAt: NOW },
    ]);
    const { service } = build({ probes: probes(fullDisk) }, alerts);
    await service.evaluate();
    expect(alerts.rows[0]!.message).toBe('The disk is 92% full.');
  });

  it('survives a failing mail relay, and skips unknown kinds when listing', async () => {
    const alerts = memoryAlerts([
      { id: 'x', kind: 'backup_failed', message: 'future kind', openedAt: NOW, notifiedAt: null },
    ]);
    const { service } = build(
      {
        probes: probes(fullDisk),
        mailer: { send: () => Promise.reject(new Error('SMTP down')) },
      },
      alerts,
    );
    await expect(service.evaluate()).resolves.toEqual(['disk_full']);
    expect((await service.listOpen()).alerts.map((a) => a.kind)).toEqual(['disk_full']);
  });
});
