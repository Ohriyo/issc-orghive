import { CONSTITUTION_DOCUMENT_TYPE, HANDBOOK_DOCUMENT_TYPE } from '@orghive/shared';

/*
 * Document types Orghive files itself, each from its own screen, never through the general
 * upload form or the document actions (docs/DOMAIN_RULES.md): an organization's Constitution &
 * By-laws (its profile) and the ISSC's Student Handbook (/admin/handbook). Both are always
 * public, view-only, and only ever replaced by a new version. The one place that decides it.
 */

export type ManagedKind = 'constitution' | 'handbook';

export type ManagedAction = 'file' | 'edit' | 'reupload' | 'visibility' | 'archive' | 'delete';

const NAMES: Record<ManagedKind, string> = {
  constitution: 'The Constitution & By-laws',
  handbook: 'The Student Handbook',
};
const HOME: Record<ManagedKind, string> = {
  constitution: 'your organization profile',
  handbook: 'Admin › Student Handbook',
};
const INSTEAD: Record<ManagedKind, string> = {
  constitution: 'upload an amendment instead',
  handbook: 'upload a corrected version instead',
};

export function managedKindOf(type: { slug: string }): ManagedKind | null {
  if (type.slug === CONSTITUTION_DOCUMENT_TYPE.slug) return 'constitution';
  if (type.slug === HANDBOOK_DOCUMENT_TYPE.slug) return 'handbook';
  return null;
}

/** Why the general document routes refuse `action` on a managed document. */
export function managedRefusal(kind: ManagedKind, action: ManagedAction): string {
  const name = NAMES[kind];
  switch (action) {
    case 'file':
      return `typeId: Upload ${name.replace(/^The /, 'the ')} from ${HOME[kind]}`;
    case 'edit':
    case 'reupload':
      return `${name} is ${kind === 'constitution' ? 'amended' : 'updated'} from ${HOME[kind]}`;
    case 'visibility':
      return `${name} is always public`;
    case 'archive':
      return `${name} cannot be archived; ${INSTEAD[kind]}`;
    case 'delete':
      return `${name} cannot be deleted; ${INSTEAD[kind]}`;
  }
}
