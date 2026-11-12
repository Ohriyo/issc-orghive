import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  QUEUE_JOB_STATES,
  queueJobListSchema,
  queueListSchema,
  queueSummarySchema,
  type QueueJob,
  type QueueJobState,
} from '@orghive/shared';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatCount, formatDateTime, messageOf, toSearch } from './system-format';
import { useStepUp } from './use-step-up';
import type { Confirming } from './use-system-users';

/** What each queue does, in the console's words; pausing it stops exactly this. */
export const QUEUE_PURPOSES: Record<string, string> = {
  documents:
    'Virus scans of new uploads, the hourly compliance check and scheduled organization posts.',
  previews: 'View-only page images of each clean file.',
  integrity: 'Checks of project task files: task codes, duplicates and keywords.',
  notifications: 'Notification emails.',
  reports: 'Semestral End Reports.',
  leaderboard: 'Leaderboard recomputes.',
  system: 'The worker’s 1-minute metrics and the daily prune.',
};

const STATE_LABELS: Record<QueueJobState, string> = {
  waiting: 'Waiting',
  active: 'Running',
  delayed: 'Delayed',
  failed: 'Failed',
  completed: 'Completed',
};

export const JOB_STATE_OPTIONS = QUEUE_JOB_STATES.map((value) => ({
  value,
  label: STATE_LABELS[value],
}));

export interface QueueRow {
  name: string;
  purpose: string;
  paused: boolean;
  counts: { state: QueueJobState; label: string; value: string }[];
  /** Failed jobs are waiting for a decision. */
  attention: boolean;
}

export interface JobRow {
  id: string;
  name: string;
  /** The job's input, pretty-printed (ids only). */
  data: string;
  attempts: string;
  failedReason: string | null;
  queued: string;
  finished: string | null;
}

function toJobRow(job: QueueJob): JobRow {
  return {
    id: job.id,
    name: job.name,
    data: JSON.stringify(job.data, null, 2),
    attempts:
      job.maxAttempts === null
        ? `${job.attemptsMade} attempts`
        : `${job.attemptsMade} of ${job.maxAttempts} attempts`,
    failedReason: job.failedReason,
    queued: formatDateTime(job.queuedAt),
    finished: job.finishedAt ? formatDateTime(job.finishedAt) : null,
  };
}

/**
 * /system/queues: every background queue, the jobs of one in one state, and the actions:
 * retry or remove a failed job, pause or resume a queue (a step-up first). Every action is
 * audited by the API.
 */
export function useQueueManager() {
  const queryClient = useQueryClient();
  const stepUp = useStepUp();
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setStateRaw] = useState<QueueJobState>('failed');
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState<Confirming | null>(null);

  const list = useQuery({
    queryKey: queryKeys.system.queues,
    queryFn: () => api.get('/system/queues', { schema: queueListSchema }),
    staleTime: 10_000,
  });
  const queue = selected ?? list.data?.queues[0]?.name ?? null;

  const jobs = useQuery({
    queryKey: queryKeys.system.queueJobs(queue ?? '', state, page),
    queryFn: () =>
      api.get(
        `/system/queues/${encodeURIComponent(queue!)}/jobs${toSearch({ state, page: String(page) })}`,
        { schema: queueJobListSchema },
      ),
    enabled: queue !== null,
    staleTime: 10_000,
  });

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: queryKeys.system.queues });

  const jobAction = useMutation({
    mutationFn: ({ action, jobId }: { action: 'retry' | 'remove'; jobId: string }) =>
      api.post(
        `/system/queues/${encodeURIComponent(queue!)}/jobs/${encodeURIComponent(jobId)}/${action}`,
      ),
    onSuccess: (_data, { action }) =>
      toast.success(action === 'retry' ? 'Job queued again' : 'Job removed'),
    onError: (error) => toast.error(messageOf(error)),
    onSettled: refreshAll,
  });

  const pauseAction = useMutation({
    mutationFn: ({ name, pause }: { name: string; pause: boolean }) =>
      stepUp.guard(() =>
        api.post(
          `/system/queues/${encodeURIComponent(name)}/${pause ? 'pause' : 'resume'}`,
          undefined,
          {
            schema: queueSummarySchema,
          },
        ),
      ),
    onSuccess: (result) => {
      if (result) toast.success(result.paused ? `${result.name} paused` : `${result.name} resumed`);
    },
    onError: (error) => toast.error(messageOf(error)),
    onSettled: refreshAll,
  });

  if (list.isPending) return { status: 'loading' as const };
  if (list.isError) return { status: 'error' as const, retry: () => void list.refetch() };

  const queues: QueueRow[] = list.data.queues.map((q) => ({
    name: q.name,
    purpose: QUEUE_PURPOSES[q.name] ?? '',
    paused: q.paused,
    counts: QUEUE_JOB_STATES.map((s) => ({
      state: s,
      label: STATE_LABELS[s],
      value: formatCount(q[s]),
    })),
    attention: q.failed > 0,
  }));
  const current = list.data.queues.find((q) => q.name === queue) ?? null;

  const select = (name: string) => {
    setSelected(name);
    setPage(0);
  };
  const setState = (next: QueueJobState) => {
    setStateRaw(next);
    setPage(0);
  };

  const jobsModel = jobs.isPending
    ? ({ status: 'loading' } as const)
    : jobs.isError
      ? ({ status: 'error', retry: () => void jobs.refetch() } as const)
      : (() => {
          const pageCount = Math.max(1, Math.ceil(jobs.data.total / jobs.data.pageSize));
          return {
            status: 'ready',
            rows: jobs.data.items.map(toJobRow),
            total: jobs.data.total,
            page: jobs.data.page,
            pageCount,
            canPrevious: page > 0,
            canNext: page + 1 < pageCount,
            previous: () => setPage((p) => Math.max(0, p - 1)),
            next: () => setPage((p) => p + 1),
          } as const;
        })();

  return {
    status: 'ready' as const,
    queues,
    selected: current
      ? { name: current.name, paused: current.paused, purpose: QUEUE_PURPOSES[current.name] ?? '' }
      : null,
    select,
    state,
    setState,
    stateOptions: JOB_STATE_OPTIONS,
    stateLabel: STATE_LABELS[state],
    jobs: jobsModel,
    /** Retry and remove act on failed jobs only. */
    canActOnJobs: state === 'failed',
    busyJobId: jobAction.isPending ? jobAction.variables.jobId : null,
    retry: (jobId: string) => jobAction.mutate({ action: 'retry', jobId }),
    askRemove: (jobId: string) =>
      setConfirming({
        kind: 'deactivate',
        title: 'Remove this failed job?',
        body: 'Its error is deleted and it will not run again. Whatever it was doing (a scan, an email, a preview) stays undone. The removal is audited.',
        confirmLabel: 'Remove job',
        run: () => {
          setConfirming(null);
          jobAction.mutate({ action: 'remove', jobId });
        },
      }),
    pausing: pauseAction.isPending,
    askTogglePause: () => {
      if (!current) return;
      const pause = !current.paused;
      setConfirming({
        kind: pause ? 'deactivate' : 'reactivate',
        title: pause ? `Pause ${current.name}?` : `Resume ${current.name}?`,
        body: pause
          ? `Workers stop taking jobs from it until it is resumed; running jobs finish. Paused, this stops: ${QUEUE_PURPOSES[current.name] ?? 'its jobs.'} You will be asked for an authenticator code.`
          : 'Workers start taking its waiting jobs again. You will be asked for an authenticator code.',
        confirmLabel: pause ? 'Pause queue' : 'Resume queue',
        run: () => {
          setConfirming(null);
          pauseAction.mutate({ name: current.name, pause });
        },
      });
    },
    confirming,
    cancelConfirm: () => setConfirming(null),
    stepUp: stepUp.dialog,
    refresh: () => void refreshAll(),
    isRefreshing: list.isFetching,
    generatedAt: formatDateTime(list.data.generatedAt),
  };
}

export type QueueManagerModel = ReturnType<typeof useQueueManager>;
