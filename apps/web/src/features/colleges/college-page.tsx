import { useParams } from 'react-router';
import { useCollegePage } from './presenters/use-college-page';
import { CollegeNotFound } from './views/college-not-found';
import { CollegeView } from './views/college-view';

/** /colleges/:slug: the college, the honeycomb of its SBOs, and its CSC. */
export function CollegePage() {
  const { slug = '' } = useParams();
  const state = useCollegePage(slug);

  if (state.status === 'not-found') return <CollegeNotFound />;
  return <CollegeView {...state} />;
}
