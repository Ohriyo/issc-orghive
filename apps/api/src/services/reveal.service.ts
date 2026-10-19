import {
  ErrorCode,
  REVEAL_TTL_DAYS,
  revealEntrySchema,
  type RevealEntry,
  type RevealPurpose,
  type RevealResponse,
  type RevealStatus,
} from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { SecretBox } from '#src/lib/secret-box';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type { RevealRepository } from '#src/repositories/reveal.repository';
import type { RequestContext } from '#src/services/auth.service';
import type { NotificationService } from '#src/services/notification.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const entriesSchema = revealEntrySchema.array().min(1);

export interface RevealServiceDeps {
  reveals: RevealRepository;
  /** MFA_ENCRYPTION_KEY's box. Without it no password can be delivered. */
  secrets: SecretBox | null;
  notifications: Pick<NotificationService, 'notify'>;
  audit: Pick<AuditLogRepository, 'record'>;
  now?: () => Date;
}

export interface Delivery {
  recipientId: string;
  purpose: RevealPurpose;
  entries: RevealEntry[];
  issuedById: string | null;
  /** The notification's title and body. Never the password: they are emailed. */
  title: string;
  body: string;
}

/**
 * The one-time Reveal (docs/DOMAIN_RULES.md, "Accounts"). Temporary passwords are stored only
 * as hashes on the accounts; the one readable copy is sealed here for its recipient, shown
 * once, then erased. Unrevealed copies are erased after REVEAL_TTL_DAYS by the worker.
 */
export function createRevealService({
  reveals,
  secrets,
  notifications,
  audit,
  now = () => new Date(),
}: RevealServiceDeps) {
  function box(): SecretBox {
    if (!secrets) {
      throw new AppError(
        503,
        ErrorCode.INTERNAL_ERROR,
        'MFA_ENCRYPTION_KEY is not set, so temporary passwords cannot be delivered',
      );
    }
    return secrets;
  }

  function statusOf(row: {
    id: string;
    purpose: RevealPurpose;
    entryCount: number;
    createdAt: Date;
    expiresAt: Date;
    revealedAt: Date | null;
    sealed: string | null;
  }): RevealStatus {
    return {
      id: row.id,
      status: row.revealedAt
        ? 'revealed'
        : row.sealed && row.expiresAt > now()
          ? 'available'
          : 'expired',
      purpose: row.purpose,
      entryCount: row.entryCount,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      revealedAt: row.revealedAt?.toISOString() ?? null,
    };
  }

  return {
    /** Seals the passwords for the recipient and tells them, in-app and by email. */
    async deliver(input: Delivery): Promise<{ revealId: string; expiresAt: Date }> {
      const sealer = box();
      const expiresAt = new Date(now().getTime() + REVEAL_TTL_DAYS * DAY_MS);
      const payload = JSON.stringify(entriesSchema.parse(input.entries));
      const revealId = await reveals.create({
        recipientId: input.recipientId,
        purpose: input.purpose,
        entryCount: input.entries.length,
        issuedById: input.issuedById,
        expiresAt,
        seal: (id) => sealer.seal(payload, `reveal:${id}`),
      });
      await notifications.notify({
        userIds: [input.recipientId],
        kind: 'password_reveal',
        title: input.title,
        body: input.body,
        link: `/dashboard/notifications?reveal=${revealId}`,
        revealId,
      });
      return { revealId, expiresAt };
    },

    /** 404 for anyone but its recipient. */
    async status(userId: string, revealId: string): Promise<RevealStatus> {
      const row = await reveals.findForRecipient(revealId, userId);
      if (!row) throw AppError.notFound('Not found');
      return statusOf(row);
    },

    /** The passwords, once. 410 when already shown or expired; 404 for anyone else. */
    async reveal(userId: string, revealId: string, ctx: RequestContext): Promise<RevealResponse> {
      const taken = await reveals.take(revealId, userId, now());
      if (!taken) {
        const row = await reveals.findForRecipient(revealId, userId);
        if (!row) throw AppError.notFound('Not found');
        throw new AppError(
          410,
          ErrorCode.REVEAL_GONE,
          row.revealedAt
            ? 'These passwords were already revealed. Ask the super admin for a new password if one was lost.'
            : 'These passwords expired unrevealed. Ask the super admin for new ones.',
        );
      }
      const entries = entriesSchema.parse(
        JSON.parse(box().open(taken.sealed, `reveal:${revealId}`)),
      );
      await audit.record({
        action: 'password_reveal',
        actorId: userId,
        entityType: 'reveal',
        entityId: revealId,
        metadata: { purpose: taken.purpose, entryCount: taken.entryCount },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { entries };
    },

    /** The worker's hourly sweep. */
    purgeExpired(): Promise<number> {
      return reveals.purgeExpired(now());
    },
  };
}

export type RevealService = ReturnType<typeof createRevealService>;
