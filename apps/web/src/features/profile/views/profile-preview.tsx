import { useLayoutEffect, useRef, useState } from 'react';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import type { ConstitutionModel } from '@/features/organizations/presenters/use-constitution';
import type { OrganizationPageModel } from '@/features/organizations/presenters/use-organization-page';
import { OrganizationRecord } from '@/features/organizations/views/organization-record';
import { OrganizationHero } from '@/features/organizations/views/organization-view';

/** The width the desktop preview is laid out at before it is scaled into the panel. */
const DESKTOP_WIDTH = 1280;

export interface ProfilePreviewProps {
  page: OrganizationPageModel;
  constitution: ConstitutionModel;
}

/**
 * The public organization page, drawn from the form. Beside the form (lg) it is the
 * desktop page scaled down into the panel; on phones (the Preview tab) it is the phone
 * page at full size. It is inert: nothing inside can be focused or clicked.
 */
export function ProfilePreview({ page, constitution }: ProfilePreviewProps) {
  const scaled = useBreakpoint('lg');
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });

  useLayoutEffect(() => {
    if (!scaled || !frame.current || !content.current) return;
    const measure = () => {
      const width = frame.current?.clientWidth ?? DESKTOP_WIDTH;
      const scale = width / DESKTOP_WIDTH;
      setBox({ scale, height: (content.current?.offsetHeight ?? 0) * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame.current);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [scaled]);

  const pageBody = (
    <div className="bg-surface-sweep">
      <OrganizationHero status="ready" page={page} constitution={constitution} preview />
      <OrganizationRecord page={page} constitution={constitution} animate={false} />
    </div>
  );

  if (!scaled) {
    return (
      <div inert className="overflow-hidden rounded-3xl shadow-pool ring-1 ring-ink/10">
        {pageBody}
      </div>
    );
  }

  return (
    // Scrolls on its own: focusable so keyboards can scroll it, though its content is inert.
    <div
      ref={frame}
      role="region"
      aria-label="Scrollable preview of your organization page"
      tabIndex={0}
      className="overflow-x-hidden overflow-y-auto rounded-3xl bg-surface shadow-pool ring-1 ring-ink/10 outline-offset-4 focus-visible:outline-2 focus-visible:outline-ink [scrollbar-color:var(--color-sage)_transparent] [scrollbar-width:thin]"
      style={{ maxHeight: 'calc(100dvh - var(--header-h) - 8rem)' }}
    >
      <div style={{ height: box.height }}>
        <div
          ref={content}
          inert
          style={{
            width: DESKTOP_WIDTH,
            transform: `scale(${box.scale})`,
            transformOrigin: 'top left',
          }}
        >
          {pageBody}
        </div>
      </div>
    </div>
  );
}
