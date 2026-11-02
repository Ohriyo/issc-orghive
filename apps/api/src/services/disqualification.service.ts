import type {
  Disqualification,
  DisqualificationsQuery,
  DisqualificationsResponse,
  DisqualifyRequest,
  LiftDisqualificationRequest,
  SemesterKey,
} from '@orghive/shared';
import { SEMESTER_LABELS } from '@orghive/shared';
import { AppError } from '#src/errors/app-error';
import type { AuditLogRepository } from '#src/repositories/audit-log.repository';
import type {
  DisqualificationRecord,
  DisqualificationRepository,
} from '#src/repositories/disqualification.repository';
import type { RequestContext } from '#src/services/auth.service';
import type { LeaderboardRecompute } from '#src/services/leaderboard-recompute';
import type { LeaderboardService } from '#src/services/leaderboard.service';
import type { NotificationService } from '#src/services/notification.service';
import type { Recipients } from '#src/services/recipients.service';

export interface DisqualificationServiceDeps {
  disqualifications: Pick<
    DisqualificationRepository,
    'list' | 'findById' | 'rankedOrganizations' | 'create' | 'lift'
  >;
  leaderboard: Pick<LeaderboardService, 'meta'>;
  recompute: Pick<LeaderboardRecompute, 'forSemesters'>;
  recipients: Pick<Recipients, 'officersOf'>;
  notifications: Pick<NotificationService, 'notify'>;
  audit: Pick<AuditLogRepository, 'record'>;
  now?: () => Date;
}

type RankedType = 'SBO' | 'CSC';

function toDisqualification(record: DisqualificationRecord): Disqualification {
  return {
    id: record.id,
    organization: { ...record.organization, type: record.organization.type as RankedType },
    reason: record.reason,
    actingAs: record.actingAs,
    createdAt: record.createdAt.toISOString(),
    lifted: record.liftedAt
      ? {
          reason: record.liftReason ?? '',
          actingAs: record.liftActingAs ?? '',
          at: record.liftedAt.toISOString(),
        }
      : null,
  };
}

const semesterName = ({ academicYear, semester }: SemesterKey) =>
  `${SEMESTER_LABELS[semester]} ${academicYear}`;

/**
 * The ISSC account disqualifies an organization from a semester's leaderboard, with a reason,
 * and can lift it with a reason (spec 5B). Audited with "Acting as", the organization is told
 * and the board recomputed. Once the standings are final, nothing changes.
 */
export function createDisqualificationService({
  disqualifications,
  leaderboard,
  recompute,
  recipients,
  notifications,
  audit,
  now = () => new Date(),
}: DisqualificationServiceDeps) {
  async function requireProvisional(key: SemesterKey): Promise<void> {
    const { status } = await leaderboard.meta(key);
    if (status === 'final') {
      throw AppError.conflict('The standings of this semester are final and can no longer change.');
    }
  }

  async function tell(
    organizationId: string,
    title: string,
    body: string,
    dedupeKey: string,
  ): Promise<void> {
    const userIds = await recipients.officersOf(organizationId);
    if (userIds.length === 0) return;
    await notifications.notify({
      userIds,
      kind: 'leaderboard_penalty',
      title,
      body,
      link: '/leaderboard',
      dedupeKey,
    });
  }

  return {
    /** GET /admin/disqualifications. */
    async list(query: DisqualificationsQuery): Promise<DisqualificationsResponse> {
      const [meta, records, organizations] = await Promise.all([
        leaderboard.meta(query),
        disqualifications.list(query),
        disqualifications.rankedOrganizations(),
      ]);
      return {
        status: meta.status,
        items: records.map(toDisqualification),
        organizations: organizations.map((org) => ({ ...org, type: org.type as RankedType })),
      };
    },

    /** POST /admin/disqualifications. */
    async disqualify(
      userId: string,
      input: DisqualifyRequest,
      ctx: RequestContext,
    ): Promise<Disqualification> {
      const key = { academicYear: input.academicYear, semester: input.semester };
      await requireProvisional(key);
      const ranked = await disqualifications.rankedOrganizations();
      if (!ranked.some((org) => org.id === input.organizationId)) {
        throw AppError.notFound('That organization cannot be ranked');
      }
      const created = await disqualifications.create({
        organizationId: input.organizationId,
        ...key,
        reason: input.reason,
        actingAs: input.actingAs,
        createdById: userId,
      });
      if (!created) {
        throw AppError.conflict('This organization is already disqualified from this semester');
      }
      await audit.record({
        action: 'leaderboard_disqualify',
        actorId: userId,
        entityType: 'leaderboard_disqualification',
        entityId: created.id,
        organizationId: input.organizationId,
        metadata: { ...key, reason: input.reason },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        actingAs: input.actingAs,
      });
      await recompute.forSemesters(key);
      await tell(
        input.organizationId,
        `Disqualified from the ${semesterName(key)} leaderboard`,
        `The ISSC disqualified your organization from this semester’s leaderboard: “${input.reason}” It is left off the board. Your files and projects are not affected.`,
        `disqualified:${created.id}`,
      );
      return toDisqualification(created);
    },

    /** POST /admin/disqualifications/:id/lift. */
    async lift(
      userId: string,
      id: string,
      input: LiftDisqualificationRequest,
      ctx: RequestContext,
    ): Promise<Disqualification> {
      const record = await disqualifications.findById(id);
      if (!record) throw AppError.notFound('Disqualification not found');
      const key = { academicYear: record.academicYear, semester: record.semester };
      await requireProvisional(key);
      const lifted = await disqualifications.lift(id, {
        reason: input.reason,
        actingAs: input.actingAs,
        byId: userId,
        at: now(),
      });
      if (!lifted) throw AppError.conflict('This disqualification was already lifted');
      await audit.record({
        action: 'leaderboard_disqualification_lift',
        actorId: userId,
        entityType: 'leaderboard_disqualification',
        entityId: id,
        organizationId: record.organization.id,
        metadata: { ...key, reason: input.reason },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        actingAs: input.actingAs,
      });
      await recompute.forSemesters(key);
      await tell(
        record.organization.id,
        `Back on the ${semesterName(key)} leaderboard`,
        `The ISSC lifted your organization’s disqualification: “${input.reason}” It counts on this semester’s board again.`,
        `disqualification-lifted:${id}`,
      );
      const updated = await disqualifications.findById(id);
      return toDisqualification(updated ?? record);
    },
  };
}

export type DisqualificationService = ReturnType<typeof createDisqualificationService>;
