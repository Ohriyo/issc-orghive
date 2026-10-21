import { useParams } from 'react-router';
import { usePageChrome } from '@/navigation/page-chrome';
import { chrome } from '@/navigation/trails';
import { useHandbook, yearLabel } from './presenters/use-handbook';
import { useHandbookEditions } from './presenters/use-handbook-editions';
import { EditionsView } from './views/editions-view';
import { HandbookView } from './views/handbook-view';

/** /handbook: the current Student Handbook. */
export function HandbookPage() {
  const model = useHandbook(null);
  usePageChrome(chrome.handbook(null));
  return <HandbookView model={model} />;
}

/** /handbook/:year: one edition, current or past. */
export function HandbookEditionPage() {
  const { year = '' } = useParams();
  const model = useHandbook(year);
  usePageChrome(chrome.handbook(yearLabel(year)));
  return <HandbookView model={model} />;
}

/** /handbook/editions: every edition. */
export function HandbookEditionsPage() {
  const model = useHandbookEditions();
  usePageChrome(chrome.handbookEditions());
  return <EditionsView model={model} />;
}
