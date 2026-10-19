import { RequireAuth } from '@/features/auth/auth-pages';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useComplianceOverview } from './presenters/use-compliance-overview';
import { ComplianceOverviewView } from './views/compliance-overview-view';

/** /dashboard/compliance?semester=&sort= */
export function ComplianceOverviewPage() {
  return (
    <RequireAuth>
      <ComplianceOverviewContent />
    </RequireAuth>
  );
}

function ComplianceOverviewContent() {
  usePageChrome(chrome.workspace('Compliance overview'));
  return <ComplianceOverviewView model={useComplianceOverview()} />;
}
