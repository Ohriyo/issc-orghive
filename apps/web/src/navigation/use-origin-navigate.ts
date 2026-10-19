import { useLocation, useNavigate } from 'react-router';
import { originState } from './origin';
import { currentPageLabel, useCurrentChrome } from './page-chrome';

/** navigate() into a sub-screen, recording this page as its origin (OriginLink in code). */
export function useOriginNavigate(): (to: string) => void {
  const navigate = useNavigate();
  const location = useLocation();
  const chrome = useCurrentChrome();
  return (to) => void navigate(to, { state: originState(location, currentPageLabel(chrome)) });
}
