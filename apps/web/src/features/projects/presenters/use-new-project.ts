import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import {
  createProjectRequestSchema,
  dashboardResponseSchema,
  manilaDate,
  projectDetailSchema,
  type CreateProjectRequest,
} from '@orghive/shared';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { useUnsavedChangesGuard } from '@/navigation/use-unsaved-changes';
import { canManageProjects, type OrgOption } from './use-projects';

type FormOutput = ReturnType<typeof createProjectRequestSchema.parse>;

export type NewProjectModel =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'no-organization' }
  | { status: 'forbidden'; org: OrgOption }
  | {
      status: 'ready';
      org: OrgOption;
      form: UseFormReturn<CreateProjectRequest, unknown, FormOutput>;
      /** The earliest event date allowed: today in Manila. */
      minDate: string;
      submit: () => void;
      saving: boolean;
      saveError: string | undefined;
      leave: { asking: boolean; stay: () => void; go: () => void };
    };

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

const EMPTY: CreateProjectRequest = {
  name: '',
  targetDate: '',
  location: '',
  beneficiaries: '',
  description: '',
  nomRequired: false,
  momRequired: false,
  communicationLetterRequired: false,
  attendanceSheetRequired: false,
};

/**
 * /dashboard/projects/new?org=: the five required fields (spec 2A), validated with the
 * shared schema, plus which optional pre-event documents the project needs (NOM, MOM,
 * Communication Letter, Attendance Sheet; spec 2B). On success
 * it opens the new project, where the officer uploads the proposal.
 */
export function useNewProject(): NewProjectModel {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [saveError, setSaveError] = useState<string>();
  const dashboard = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => api.get('/me/dashboard', { schema: dashboardResponseSchema }),
    staleTime: 60_000,
  });
  const form = useForm<CreateProjectRequest, unknown, FormOutput>({
    resolver: zodResolver(createProjectRequestSchema),
    defaultValues: EMPTY,
  });
  const create = useMutation({
    mutationFn: ({ slug, body }: { slug: string; body: FormOutput }) =>
      api.post(`/organizations/${slug}/projects`, body, { schema: projectDetailSchema }),
  });
  const guard = useUnsavedChangesGuard(form.formState.isDirty && !create.isSuccess);

  if (dashboard.isPending) return { status: 'loading' };
  if (dashboard.isError) return { status: 'error', retry: () => void dashboard.refetch() };
  const organizations = dashboard.data.organizations.map((o) => o.organization);
  const org = organizations.find((o) => o.slug === params.get('org')) ?? organizations[0];
  if (!org) return { status: 'no-organization' };
  if (!canManageProjects(dashboard.data, org.id)) return { status: 'forbidden', org };

  const submit = form.handleSubmit(async (body) => {
    setSaveError(undefined);
    try {
      const project = await create.mutateAsync({ slug: org.slug, body });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
      guard.allowNextNavigation();
      toast.success('Project created. Upload the signed Project Proposal within 14 days.');
      void navigate(`/projects/${project.id}`, { replace: true });
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  });

  return {
    status: 'ready',
    org,
    form,
    minDate: manilaDate(new Date()),
    submit: () => void submit(),
    saving: form.formState.isSubmitting,
    saveError,
    leave: {
      asking: guard.blocker.state === 'blocked',
      stay: () => guard.blocker.reset?.(),
      go: () => guard.blocker.proceed?.(),
    },
  };
}
