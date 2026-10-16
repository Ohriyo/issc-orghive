import type { AuthMembership } from '@orghive/shared';
import { initialsOf } from '@/lib/initials';
import { useAuth } from './use-auth';
import { useSignOut } from './use-auth-forms';

/** The header's account entry: a Login link, or the signed-in user's menu. */
export type AccountMenuModel =
  | { status: 'anonymous' }
  | {
      status: 'authenticated';
      name: string;
      email: string;
      /** Up to two letters for the avatar, e.g. "JD". */
      initials: string;
      /** One line per active membership: "JPICE, Officer (President)". */
      roles: string[];
      signOut: () => void;
      isSigningOut: boolean;
    };

const ROLE_LABEL: Record<AuthMembership['role'], string> = {
  officer: 'Officer',
  adviser: 'Adviser',
  admin: 'Admin',
};

export function roleLine(m: AuthMembership): string {
  const role = ROLE_LABEL[m.role];
  return m.title && m.title !== role
    ? `${m.orgAcronym}, ${role} (${m.title})`
    : `${m.orgAcronym}, ${role}`;
}

export function useAccountMenu(): AccountMenuModel {
  const { status, user } = useAuth();
  const { signOut, isSigningOut } = useSignOut();
  if (status !== 'authenticated' || !user) return { status: 'anonymous' };
  return {
    status: 'authenticated',
    name: user.name,
    email: user.email,
    initials: initialsOf(user.name).slice(0, 2) || '?',
    roles: (user.memberships ?? []).map(roleLine),
    signOut,
    isSigningOut,
  };
}
