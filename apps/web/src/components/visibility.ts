import type { DocumentVisibility } from '@orghive/shared';

/**
 * Who can see a document, in plain words. The organization's account chooses it on upload
 * and can change it at any time; nobody reviews documents (docs/DOMAIN_RULES.md).
 */
export const VISIBILITY_OPTIONS: { value: DocumentVisibility; label: string; hint: string }[] = [
  { value: 'public', label: 'Public', hint: 'Anyone, without signing in' },
  {
    value: 'governing',
    label: 'Governing bodies',
    hint: 'Your organization, your college CSC and the ISSC',
  },
  { value: 'private', label: 'Private', hint: 'Your organization only' },
];

export const VISIBILITY_LABEL: Record<DocumentVisibility, string> = {
  public: 'Public',
  governing: 'Governing bodies',
  private: 'Private',
};
