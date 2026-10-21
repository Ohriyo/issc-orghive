import { useState } from 'react';
import {
  financialFiguresFormSchema,
  formatPesos,
  parsePesos,
  pesosInputValue,
  type FinancialFiguresInput,
  type ProjectFinancialFigures,
} from '@orghive/shared';
import { formatManilaDate } from './project-format';

/** The Financial Report's totals on its task card (docs/PROJECT_WORKFLOW_SPEC.md, 5D). */
export interface FiguresModel {
  /** Officers enter the totals with the file; others only read them. */
  editable: boolean;
  income: string;
  expenses: string;
  onIncomeChange: (value: string) => void;
  onExpensesChange: (value: string) => void;
  errors: { income?: string; expenses?: string };
  /** Net profit of what is typed, once both are amounts. */
  netPreview: { text: string; negative: boolean } | null;
  /** What is stored, as pesos. */
  saved: { income: string; expenses: string; net: string; negative: boolean } | null;
  /** The ISSC is checking the figures: left out of the leaderboard total until cleared. */
  underReview: { remark: string; since: string } | null;
}

export interface FiguresDraft {
  model: (stored: ProjectFinancialFigures | null, editable: boolean) => FiguresModel;
  /**
   * Checks the typed totals with the shared rule. Returns them in centavos, or null and
   * shows why; the upload must not go ahead then.
   */
  take: (stored: ProjectFinancialFigures | null) => FinancialFiguresInput | null;
}

/** Shapes the stored figures and the officer's draft. Pure. */
export function toFiguresModel(
  stored: ProjectFinancialFigures | null,
  draft: { income?: string; expenses?: string },
  errors: FiguresModel['errors'],
  editable: boolean,
  on: Pick<FiguresModel, 'onIncomeChange' | 'onExpensesChange'>,
): FiguresModel {
  const income = draft.income ?? (stored ? pesosInputValue(stored.incomeCentavos) : '');
  const expenses = draft.expenses ?? (stored ? pesosInputValue(stored.expensesCentavos) : '');
  const typedIncome = parsePesos(income);
  const typedExpenses = parsePesos(expenses);
  const net = typedIncome !== null && typedExpenses !== null ? typedIncome - typedExpenses : null;
  return {
    editable,
    income,
    expenses,
    ...on,
    errors,
    netPreview: net === null ? null : { text: formatPesos(net), negative: net < 0 },
    saved: stored && {
      income: formatPesos(stored.incomeCentavos),
      expenses: formatPesos(stored.expensesCentavos),
      net: formatPesos(stored.netCentavos),
      negative: stored.netCentavos < 0,
    },
    underReview: stored?.underReview
      ? {
          remark: stored.underReview.remark,
          since: formatManilaDate(stored.underReview.flaggedAt),
        }
      : null,
  };
}

/** The officer's typed totals for the Financial Report, until they upload it. */
export function useFiguresDraft(): FiguresDraft {
  const [draft, setDraft] = useState<{ income?: string; expenses?: string }>({});
  const [errors, setErrors] = useState<FiguresModel['errors']>({});

  const on = {
    onIncomeChange: (income: string) => {
      setDraft((d) => ({ ...d, income }));
      setErrors((e) => ({ ...e, income: undefined }));
    },
    onExpensesChange: (expenses: string) => {
      setDraft((d) => ({ ...d, expenses }));
      setErrors((e) => ({ ...e, expenses: undefined }));
    },
  };

  return {
    model: (stored, editable) => toFiguresModel(stored, draft, errors, editable, on),
    take: (stored) => {
      const { income, expenses } = toFiguresModel(stored, draft, {}, true, on);
      const parsed = financialFiguresFormSchema.safeParse({ income, expenses });
      if (!parsed.success) {
        const next: FiguresModel['errors'] = {};
        for (const issue of parsed.error.issues) {
          const field = issue.path[0] as 'income' | 'expenses';
          next[field] ??= issue.message;
        }
        setErrors(next);
        return null;
      }
      setErrors({});
      return { incomeCentavos: parsed.data.income, expensesCentavos: parsed.data.expenses };
    },
  };
}
