import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import {
  appealAttachmentSchema,
  appealReasonSchema,
  appealSchema,
  contentTypeForFilename,
  MAX_APPEAL_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  organizationComplianceSchema,
  uploadUrlResponseSchema,
  type AppealAttachment,
  type SubmitAppealRequest,
} from '@orghive/shared';
import {
  RefusedFileError,
  uploadErrorMessage,
} from '@/features/documents/presenters/upload-version';
import { useAuth } from '@/features/auth/presenters/use-auth';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { putWithProgress } from '@/lib/upload-put';
import { useBackNavigation } from '@/navigation/use-back-navigation';
import { useUnsavedChangesGuard } from '@/navigation/use-unsaved-changes';
import { fileSize, reportList } from './appeal-format';
import { useIsOfficerOf } from './use-compliance';

export const appealFormSchema = z.object({ reason: appealReasonSchema });
type AppealForm = z.input<typeof appealFormSchema>;
type AppealFormOutput = z.output<typeof appealFormSchema>;

export const ATTACHMENT_TYPES_LABEL = 'PDF, Word, Excel, PowerPoint, JPG or PNG, up to 25 MB';

/** One supporting file on the form, from the browser's upload to the virus scan's verdict. */
export interface AttachmentRow {
  key: string;
  filename: string;
  size: string;
  state:
    | { status: 'uploading'; progress: number }
    | { status: 'checking' }
    | { status: 'clean' }
    | { status: 'refused' }
    | { status: 'error'; message: string };
  remove: () => void;
}

/** What is being appealed, from the URL. */
export interface AppealTarget {
  kind: 'blocked' | 'frozen';
  orgSlug: string;
  orgAcronym: string;
  projectName: string;
  projectId: string;
  /** "The Project Proposal was due Oct 15, 2026 and was not submitted." */
  summary: string;
  deciderAcronym: string;
  lastRejection: { remarks: string } | null;
}

export type SubmitAppealModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  /** The project is not blocked, the freeze was lifted, or an appeal is already pending. */
  | { status: 'nothing'; message: string; href: string }
  | { status: 'forbidden' }
  | {
      status: 'ready';
      target: AppealTarget;
      form: UseFormReturn<AppealForm, unknown, AppealFormOutput>;
      attachments: AttachmentRow[];
      canAddAttachment: boolean;
      addFiles: (files: File[]) => void;
      submit: () => void;
      saving: boolean;
      /** Why the appeal cannot be sent yet (files still being checked). */
      blockedReason: string | null;
      saveError: string | undefined;
      leave: { asking: boolean; stay: () => void; go: () => void };
    };

interface LocalAttachment {
  key: string;
  filename: string;
  sizeBytes: number;
  id: string | null;
  progress: number;
  error: string | null;
}

/**
 * /dashboard/appeals/new?org=&project= (a blocked project) or &freeze= (a freeze): the
 * written reason, validated with the shared schema, and optional supporting files. Each
 * file goes straight to storage, then waits for the virus scan; the appeal can be sent
 * once every file is clean.
 */
export function useSubmitAppeal(): SubmitAppealModel {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const slug = params.get('org') ?? '';
  const projectId = params.get('project');
  const freezeId = params.get('freeze');
  const isOfficer = useIsOfficerOf(slug || null);
  const { user } = useAuth();
  const orgAcronym = user?.organization?.slug === slug ? user.organization.acronym : slug;
  const [files, setFiles] = useState<LocalAttachment[]>([]);
  const [saveError, setSaveError] = useState<string>();

  const compliance = useQuery({
    queryKey: queryKeys.appeals.compliance(slug),
    queryFn: () =>
      api.get(`/organizations/${slug}/compliance`, { schema: organizationComplianceSchema }),
    enabled: !!slug,
    staleTime: 30_000,
  });
  // Poll each uploaded file until the worker has checked it.
  const scans = useQueries({
    queries: files
      .filter((f) => f.id)
      .map((f) => ({
        queryKey: queryKeys.appeals.attachment(f.id!),
        queryFn: () =>
          api.get(`/organizations/${slug}/appeal-attachments/${f.id}`, {
            schema: appealAttachmentSchema,
          }),
        refetchInterval: (q: { state: { data?: AppealAttachment } }) =>
          q.state.data?.scanStatus === 'pending' || !q.state.data ? 2000 : false,
      })),
  });
  const scanOf = new Map(scans.flatMap((q) => (q.data ? [[q.data.id, q.data.scanStatus]] : [])));

  const form = useForm<AppealForm, unknown, AppealFormOutput>({
    resolver: zodResolver(appealFormSchema),
    defaultValues: { reason: '' },
  });
  const send = useMutation({
    mutationFn: (body: SubmitAppealRequest) =>
      api.post(`/organizations/${slug}/appeals`, body, { schema: appealSchema }),
  });
  const guard = useUnsavedChangesGuard(
    (form.formState.isDirty || files.length > 0) && !send.isSuccess,
  );
  const parent = projectId
    ? { path: `/projects/${projectId}`, label: 'Project' }
    : { path: '/dashboard', label: 'Dashboard' };
  const back = useBackNavigation(parent);

  if (!slug || (!projectId && !freezeId)) {
    return {
      status: 'nothing',
      message: 'Choose what to appeal from your dashboard.',
      href: '/dashboard',
    };
  }
  if (compliance.isError) return { status: 'error', retry: () => void compliance.refetch() };
  if (!compliance.data) return { status: 'loading' };
  const data = compliance.data;

  const decider = data.decider.acronym;
  let target: AppealTarget | null = null;
  let pending = false;
  if (projectId) {
    const blocked = data.blockedProjects.find((p) => p.id === projectId);
    if (blocked) {
      pending = !!blocked.pendingAppeal;
      target = {
        kind: 'blocked',
        orgSlug: slug,
        orgAcronym,
        projectName: blocked.name,
        projectId: blocked.id,
        summary: `The Project Proposal for ${blocked.name} was not submitted by its deadline, so the project is blocked.`,
        deciderAcronym: decider,
        lastRejection: blocked.lastRejection && { remarks: blocked.lastRejection.remarks },
      };
    }
  } else {
    const freeze = data.freezes.find((f) => f.id === freezeId);
    if (freeze) {
      pending = !!freeze.pendingAppeal;
      target = {
        kind: 'frozen',
        orgSlug: slug,
        orgAcronym,
        projectName: freeze.project.name,
        projectId: freeze.project.id,
        summary: `The ${reportList(freeze.reports)} for ${freeze.project.name} ${freeze.reports.length > 1 ? 'were' : 'was'} not submitted on time, so your organization is frozen.`,
        deciderAcronym: decider,
        lastRejection: freeze.lastRejection && { remarks: freeze.lastRejection.remarks },
      };
    }
  }
  if (!target) {
    return {
      status: 'nothing',
      message: projectId
        ? 'This project is not blocked, so there is nothing to appeal.'
        : 'This freeze was already lifted.',
      href: projectId ? `/projects/${projectId}` : '/dashboard',
    };
  }
  if (pending && !send.isSuccess) {
    return {
      status: 'nothing',
      message: `An appeal for this is already waiting for ${decider}'s decision.`,
      href: projectId ? `/projects/${projectId}` : '/dashboard',
    };
  }
  if (!isOfficer) return { status: 'forbidden' };

  const update = (key: string, patch: Partial<LocalAttachment>) =>
    setFiles((all) => all.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  async function upload(file: File, key: string) {
    try {
      const contentType = contentTypeForFilename(file.name);
      if (!contentType || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        throw new RefusedFileError(`Use a ${ATTACHMENT_TYPES_LABEL}.`);
      }
      const url = await api.post(
        `/organizations/${slug}/appeal-attachments/upload-url`,
        { filename: file.name, contentType, sizeBytes: file.size },
        { schema: uploadUrlResponseSchema },
      );
      await putWithProgress(url.url, file, url.headers, (fraction) =>
        update(key, { progress: Math.round(fraction * 100) }),
      );
      const created = await api.post(
        `/organizations/${slug}/appeal-attachments`,
        { uploadKey: url.uploadKey },
        { schema: appealAttachmentSchema },
      );
      update(key, { id: created.id });
    } catch (error) {
      update(key, { error: uploadErrorMessage(error) });
    }
  }

  const rows: AttachmentRow[] = files.map((f) => {
    const scan = f.id ? scanOf.get(f.id) : undefined;
    const state: AttachmentRow['state'] = f.error
      ? { status: 'error', message: f.error }
      : !f.id
        ? { status: 'uploading', progress: f.progress }
        : scan === 'clean'
          ? { status: 'clean' }
          : scan === 'infected' || scan === 'invalid'
            ? { status: 'refused' }
            : { status: 'checking' };
    return {
      key: f.key,
      filename: f.filename,
      size: fileSize(f.sizeBytes),
      state,
      remove: () => setFiles((all) => all.filter((x) => x.key !== f.key)),
    };
  });
  const notReady = rows.filter((r) => r.state.status !== 'clean');
  const blockedReason = notReady.some(
    (r) => r.state.status === 'uploading' || r.state.status === 'checking',
  )
    ? 'Wait until every file has been checked for viruses.'
    : notReady.length > 0
      ? 'Remove the files that could not be used.'
      : null;

  const submit = form.handleSubmit(async ({ reason }) => {
    if (blockedReason) return;
    setSaveError(undefined);
    const attachmentIds = files.flatMap((f) => (f.id ? [f.id] : []));
    const body: SubmitAppealRequest =
      target.kind === 'blocked'
        ? { type: 'PROJECT_BLOCK', projectId: target.projectId, reason, attachmentIds }
        : { type: 'ORG_FREEZE', freezeId: freezeId!, reason, attachmentIds };
    try {
      await send.mutateAsync(body);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.appeals.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
      ]);
      guard.allowNextNavigation();
      back.finish(`Appeal submitted. ${decider} will decide it.`);
    } catch (error) {
      setSaveError(uploadErrorMessage(error));
    }
  });

  return {
    status: 'ready',
    target,
    form,
    attachments: rows,
    canAddAttachment: files.length < MAX_APPEAL_ATTACHMENTS,
    addFiles: (picked) => {
      const room = MAX_APPEAL_ATTACHMENTS - files.length;
      for (const file of picked.slice(0, room)) {
        const key = crypto.randomUUID();
        setFiles((all) => [
          ...all,
          { key, filename: file.name, sizeBytes: file.size, id: null, progress: 0, error: null },
        ]);
        void upload(file, key);
      }
    },
    submit: () => void submit(),
    saving: form.formState.isSubmitting,
    blockedReason,
    saveError,
    leave: {
      asking: guard.blocker.state === 'blocked',
      stay: () => guard.blocker.reset?.(),
      go: () => guard.blocker.proceed?.(),
    },
  };
}
