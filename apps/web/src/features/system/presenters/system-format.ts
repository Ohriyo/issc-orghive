import { ApiError } from '@/lib/api';

/** Console times are Manila wall-clock times, to the minute. */
const dateTime = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Manila',
});
const date = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });
const count = new Intl.NumberFormat('en-PH');

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));
export const formatCount = (n: number) => count.format(n);

/** An API error in the interface's voice; never a raw 5xx. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError && error.status > 0 && error.status < 500) return error.message;
  if (error instanceof ApiError && error.status === 0) return error.message;
  return 'Something went wrong on our side. Try again in a moment.';
}

/** "login_failed" → "Login failed". */
export function actionLabel(action: string): string {
  const words = action.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Builds a query string, leaving out empty values. */
export function toSearch(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}
