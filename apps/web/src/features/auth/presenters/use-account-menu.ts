import type { AuthUser } from '@orghive/shared';
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
      /** The shared account's organization and officer-in-charge, e.g. "JPICE account". */
      roles: string[];
      /** Super admins get a link to /system. */
      systemConsole: boolean;
      signOut: () => void;
      isSigningOut: boolean;
    };

/** "JPICE account", then who answers for it this term. */
export function accountLines(user: AuthUser): string[] {
  if (!user.organization) return [];
  const lines = [`${user.organization.acronym} account`];
  const officer = user.officerInCharge;
  if (officer) lines.push(`Officer in charge: ${officer.name} (${officer.position})`);
  return lines;
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
    roles: accountLines(user),
    systemConsole: user.systemRole === 'SUPER_ADMIN',
    signOut,
    isSigningOut,
  };
}
