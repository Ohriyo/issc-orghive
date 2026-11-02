import {
  CHECKED_TASK_TYPES,
  nearDuplicateBitsSchema,
  PROJECT_TASK_LABELS,
  taskKeywordsSchema,
  type CheckedTaskType,
  type SystemSettings,
  type TaskKeywords,
} from '@orghive/shared';

/** The check settings as typed: the threshold as text, each task's phrases one per line. */
export interface CheckSettingsDraft {
  nearBits?: string;
  keywords: Partial<Record<CheckedTaskType, string>>;
}

export interface CheckField {
  value: string;
  error: string | undefined;
}

export interface ParsedCheckSettings {
  nearBits: CheckField;
  keywords: (CheckField & { type: CheckedTaskType; label: string })[];
  /** Both valid: what to save. */
  value: { taskKeywords: TaskKeywords; nearDuplicateBits: number } | null;
}

const MAX_PHRASES = 10;

/** One phrase a line; blank lines dropped. */
const phrasesOf = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

function phrasesError(phrases: string[]): string | undefined {
  if (phrases.length > MAX_PHRASES) return `Use at most ${MAX_PHRASES} lines`;
  const bad = phrases.find((p) => p.length < 2 || p.length > 80);
  return bad === undefined ? undefined : `Each line needs 2 to 80 characters: “${bad}”`;
}

/** Reads the form against the saved settings; pure, so the presenter stays thin. */
export function parseCheckSettings(
  saved: SystemSettings,
  draft: CheckSettingsDraft,
): ParsedCheckSettings {
  const nearText = draft.nearBits ?? String(saved.nearDuplicateBits);
  const near = nearDuplicateBitsSchema.safeParse(nearText.trim() === '' ? NaN : Number(nearText));
  const keywords = CHECKED_TASK_TYPES.map((type) => {
    const value = draft.keywords[type] ?? saved.taskKeywords[type].join('\n');
    return {
      type,
      label: PROJECT_TASK_LABELS[type],
      value,
      error: phrasesError(phrasesOf(value)),
    };
  });
  const parsed = taskKeywordsSchema.safeParse(
    Object.fromEntries(keywords.map((k) => [k.type, phrasesOf(k.value)])),
  );
  return {
    nearBits: { value: nearText, error: near.success ? undefined : near.error.issues[0]?.message },
    keywords,
    value:
      near.success && parsed.success && keywords.every((k) => !k.error)
        ? { taskKeywords: parsed.data, nearDuplicateBits: near.data }
        : null,
  };
}

/** Whether what is typed differs from what is saved. */
export function checkSettingsChanged(
  saved: SystemSettings,
  value: NonNullable<ParsedCheckSettings['value']>,
): boolean {
  return (
    value.nearDuplicateBits !== saved.nearDuplicateBits ||
    JSON.stringify(value.taskKeywords) !== JSON.stringify(saved.taskKeywords)
  );
}
