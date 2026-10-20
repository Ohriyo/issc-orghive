import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  projectFinancialFiguresSchema,
  type CorrectFinancialFiguresRequest,
  type ProjectFinancialFigures,
} from '@orghive/shared';
import type { ActingAsModel } from '@/features/auth/presenters/use-acting-as';
import { api, ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { formatManilaDate } from './project-format';
import { useFiguresDraft, type FiguresModel } from './use-figures-draft';

/** "Correct figures" on the Financial Report card (spec 5D), until the semester closes. */
export interface CorrectFiguresModel {
  /** The last day they can be corrected, e.g. "Dec 31, 2026". */
  until: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The two amounts, starting from what is stored. */
  fields: FiguresModel;
  actingAs: ActingAsModel;
  /** For the "Acting as" hint: "JPICE". */
  orgAcronym: string;
  submit: () => void;
  saving: boolean;
  error: string | null;
}

export interface CorrectFigures {
  model: (
    stored: ProjectFinancialFigures | null,
    actingAs: ActingAsModel,
    org: { acronym: string; canManage: boolean },
    now: Date,
  ) => CorrectFiguresModel | null;
}

/**
 * PATCH /projects/:projectId/financial-figures: the organization fixes its reported totals.
 * The new totals move its leaderboard profit, so the boards and its standing refresh.
 */
export function useCorrectFigures(projectId: string): CorrectFigures {
  const queryClient = useQueryClient();
  const draft = useFiguresDraft();
  const [open, setOpenState] = useState(false);
  const mutation = useMutation({
    mutationFn: (body: CorrectFinancialFiguresRequest) =>
      api.patch(`/projects/${projectId}/financial-figures`, body, {
        schema: projectFinancialFiguresSchema,
      }),
    onSuccess: async () => {
      setOpenState(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.myStanding }),
        queryClient.invalidateQueries({ queryKey: ['leaderboard'] }),
      ]);
    },
  });

  return {
    model: (stored, actingAs, org, now) => {
      // Only the organization's own account, and only until its semester closed.
      if (!org.canManage || !stored || now > new Date(stored.correctableUntil)) return null;
      return {
        until: formatManilaDate(stored.correctableUntil),
        open,
        setOpen: (next) => {
          setOpenState(next);
          if (!next) mutation.reset();
        },
        fields: draft.model(stored, true),
        actingAs,
        orgAcronym: org.acronym,
        submit: () => {
          const amounts = draft.take(stored);
          const name = actingAs.take();
          if (!amounts || !name) return;
          mutation.mutate({ ...amounts, actingAs: name });
        },
        saving: mutation.isPending,
        error:
          mutation.error instanceof ApiError
            ? mutation.error.message
            : mutation.error
              ? 'The figures could not be saved. Check your connection and try again.'
              : null,
      };
    },
  };
}
