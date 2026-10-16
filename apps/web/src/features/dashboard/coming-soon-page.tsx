import { Container } from '@/components/container';
import { RequireAuth } from '@/features/auth/auth-pages';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';

/**
 * Placeholders that the dashboard's role panels link to, so those links never 404 before
 * the features exist. Replace each with the real page when it is built.
 */
function ComingSoon({ title, body }: { title: string; body: string }) {
  usePageChrome(chrome.workspace(title));
  return (
    <div className="min-h-page">
      <title>{`${title} | Orghive`}</title>
      <Container as="main" className="pt-4 pb-section lg:pt-6">
        <h1 className="text-h1 font-bold text-ink">{title}</h1>
        <p className="mt-4 max-w-prose text-body-lg text-ink">{body}</p>
      </Container>
    </div>
  );
}

/** F11 will put the review queue here. */
export function ReviewQueuePage() {
  return (
    <RequireAuth>
      <ComingSoon
        title="Review queue"
        body="The review queue is being built. Until then, open a pending document from its organization's Paperworks to approve or reject it."
      />
    </RequireAuth>
  );
}

export function AdminPage() {
  return (
    <RequireAuth>
      <ComingSoon
        title="Administration"
        body="Admin tools for organizations, memberships and accounts are being built."
      />
    </RequireAuth>
  );
}
