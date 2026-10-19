import { useAuth } from '@/features/auth/presenters/use-auth';

/**
 * Whether the signed-in user may open /admin: the ISSC's shared account. Only a hint for the
 * UI; every /admin API route checks it again against the database.
 */
export type AdminAccess = 'checking' | 'admin' | 'forbidden';

export function useAdminAccess(): AdminAccess {
  const { status, user } = useAuth();
  if (status === 'unknown' || !user) return 'checking';
  return user.organization?.type === 'ISSC' ? 'admin' : 'forbidden';
}
