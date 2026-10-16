import type { Location } from 'react-router';
import { safeNext } from '@/features/auth/presenters/use-auth';

/** A page the user can be sent back to: where it is and what to call it ("Dashboard"). */
export interface Destination {
  path: string;
  label: string;
}

/** Route state carried by links into a sub-screen, so its back button knows the way. */
export interface OriginState {
  from?: Destination;
}

const MAX_LABEL = 80;

/**
 * The origin in a location's state, or null. Route state can be anything (another page,
 * an old history entry), so it is checked like user input: only a same-site path with a
 * short label is accepted, never another origin or a scheme.
 */
export function readOrigin(state: unknown, here?: Pick<Location, 'pathname'>): Destination | null {
  if (!state || typeof state !== 'object' || !('from' in state)) return null;
  const from = state.from;
  if (!from || typeof from !== 'object') return null;
  const { path, label } = from as Record<string, unknown>;
  if (typeof path !== 'string' || typeof label !== 'string' || !label.trim()) return null;
  // safeNext returns its fallback for anything that is not a same-site path.
  if (safeNext(path, '') !== path) return null;
  // Coming "back" to the page you are on is no way back.
  if (here && path.split(/[?#]/)[0] === here.pathname) return null;
  return { path, label: label.trim().slice(0, MAX_LABEL) };
}

/** State for a link leaving `location`, named `label`. */
export function originState(
  location: Pick<Location, 'pathname' | 'search'>,
  label: string,
): OriginState {
  return { from: { path: `${location.pathname}${location.search}`, label } };
}
