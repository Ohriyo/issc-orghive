import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PRE_EVENT_CHOICES,
  PROJECT_TASK_LABELS,
  projectDetailSchema,
  type PreEventChoiceField,
  type ProjectDetail,
} from '@orghive/shared';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface PreEventChoice {
  field: PreEventChoiceField;
  label: string;
  checked: boolean;
  /** A ticked document that already has a file stays ticked (the API refuses otherwise). */
  locked: boolean;
}

export interface PreEventChoicesModel {
  choices: PreEventChoice[];
  /** The field being saved, if any. */
  saving: PreEventChoiceField | null;
  error: string | undefined;
  toggle: (field: PreEventChoiceField, checked: boolean) => void;
}

/** The ticks as they stand, from the project the API returned. Pure. */
export function preEventChoicesOf(project: ProjectDetail): PreEventChoice[] {
  return (
    Object.entries(PRE_EVENT_CHOICES) as [keyof typeof PRE_EVENT_CHOICES, PreEventChoiceField][]
  ).map(([type, field]) => {
    const task = project.tasks.find((t) => t.type === type);
    const hasFile = !!task && (task.document !== null || task.files.length > 0);
    return {
      field,
      label: PROJECT_TASK_LABELS[type],
      checked: project[field],
      locked: project[field] && hasFile,
    };
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && (error.status === 0 || error.status < 500)) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

/**
 * Presenter for which optional pre-event documents a project needs (spec 2B): the
 * organization's own account changes a tick until that document has a file. Each change
 * saves at once (PATCH /projects/:id) and refreshes the checklist.
 */
export function usePreEventChoices(
  project: ProjectDetail | undefined,
): PreEventChoicesModel | null {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<PreEventChoiceField | null>(null);
  const [error, setError] = useState<string>();
  const save = useMutation({
    mutationFn: ({
      id,
      field,
      checked,
    }: {
      id: string;
      field: PreEventChoiceField;
      checked: boolean;
    }) => api.patch(`/projects/${id}`, { [field]: checked }, { schema: projectDetailSchema }),
  });
  if (!project) return null;

  async function toggle(field: PreEventChoiceField, checked: boolean) {
    setSaving(field);
    setError(undefined);
    try {
      const updated = await save.mutateAsync({ id: project!.id, field, checked });
      queryClient.setQueryData(queryKeys.projects.detail(updated.id), updated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
      ]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  return {
    choices: preEventChoicesOf(project),
    saving,
    error,
    toggle: (field, checked) => void toggle(field, checked),
  };
}
