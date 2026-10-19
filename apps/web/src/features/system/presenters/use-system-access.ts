import { useAuth } from '@/features/auth/presenters/use-auth';

/**
 * Whether the signed-in user may open /system: a SUPER_ADMIN. Only a hint for the UI;
 * every /system API route checks the role, MFA and account again in the database.
 */
export type SystemAccess = 'checking' | 'allowed' | 'forbidden';

export function useSystemAccess(): SystemAccess {
  const { status, user } = useAuth();
  if (status === 'unknown' || !user) return 'checking';
  return user.systemRole === 'SUPER_ADMIN' ? 'allowed' : 'forbidden';
}
