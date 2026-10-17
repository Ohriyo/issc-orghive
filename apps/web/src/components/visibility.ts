import type { DocumentVisibility } from '@orghive/shared';

/**
 * Who can see a document, in plain words. The organization's officers choose it on upload
 * and can change it at any time; nobody reviews documents (docs/DOMAIN_RULES.md).
 */
export const VISIBILITY_OPTIONS: { value: DocumentVisibility; label: string; hint: string }[] = [
  { value: 'public', label: 'Public', hint: 'Anyone, without signing in' },
  { value: 'members', label: 'Members', hint: 'Members of your organization' },
  { value: 'private', label: 'Private', hint: 'Officers of your organization' },
];

export const VISIBILITY_LABEL: Record<DocumentVisibility, string> = {
  public: 'Public',
  members: 'Members only',
  private: 'Private',
};
