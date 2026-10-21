import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  ChevronDown,
  ChevronUp,
  EyeOff,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
} from 'lucide-react';
import { usePrefersReducedMotion } from '@/components/motion';
import { SectionError } from '@/components/section-error';
import { Skeleton } from '@/components/skeleton';
import { cn } from '@/lib/utils';
import type { DocumentPagesModel, ViewerPage } from '../presenters/use-document-pages';

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;
const ICON_BUTTON =
  'grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink transition-colors hover:bg-surface focus-visible:bg-surface disabled:cursor-default disabled:text-ink-muted/40 disabled:hover:bg-transparent';

/** The easy ways to save an image: right-click, drag out, long-press (iOS). Not screenshots. */
const preventSave = (event: SyntheticEvent) => event.preventDefault();

export interface PageViewerProps {
  pages: DocumentPagesModel;
  /** The owning organization's account: it downloads the original below instead. */
  isOwner: boolean;
  title: string;
  /** The section heading; "Preview" on a document page. */
  heading?: string;
  /** Scrolls to a page whenever it changes (the handbook's contents and search). */
  jumpTo?: { page: number; nonce: number } | null;
  /** Told the page the reader is on, as they scroll. */
  onPageChange?: (page: number) => void;
  className?: string;
}

/**
 * The view-only viewer: the document's watermarked page images, loaded as they scroll near.
 * Nobody but the owning organization ever receives the original file.
 */
export function PageViewer({
  pages,
  isOwner,
  title,
  heading = 'Preview',
  jumpTo = null,
  onPageChange,
  className = 'mt-10',
}: PageViewerProps) {
  return (
    <section aria-labelledby="viewer-heading" className={className}>
      <h2 id="viewer-heading" className="text-h3 font-bold text-ink">
        {heading}
      </h2>
      <p className="mt-1 flex items-start gap-2 text-small text-ink-muted">
        <EyeOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {isOwner
          ? 'This is the watermarked, view-only copy everyone else sees. Your organization can download the original below.'
          : 'View only. This document cannot be downloaded or printed.'}
      </p>
      <div className="mt-4 print:hidden">
        {pages.status === 'ready' ? (
          <ReadyViewer pages={pages} title={title} jumpTo={jumpTo} onPageChange={onPageChange} />
        ) : pages.status === 'error' ? (
          <SectionError
            message="The preview could not be loaded. Check your connection and try again."
            onRetry={pages.retry}
          />
        ) : pages.status === 'preparing' ? (
          <Notice>
            <LoaderCircle
              aria-hidden="true"
              className="size-6 animate-spin text-forest-500 motion-reduce:animate-none"
            />
            <p className="font-semibold text-ink">Preparing preview…</p>
            <p className="max-w-prose text-small text-ink-muted">
              The pages are being made ready to view. This page updates by itself; a long file can
              take a minute.
            </p>
          </Notice>
        ) : pages.status === 'unavailable' ? (
          <Notice>
            <p className="font-semibold text-ink">No preview for this file</p>
            <p className="max-w-prose text-small text-ink-muted">
              {isOwner
                ? 'It could not be turned into pages (it may be damaged or password-protected). Download the original below, or upload a new version.'
                : 'It could not be turned into pages to view here.'}
            </p>
          </Notice>
        ) : (
          <div aria-busy="true">
            <span className="sr-only">Loading the preview</span>
            <Skeleton className="aspect-[1/1.3] w-full max-w-xl rounded-2xl" />
          </div>
        )}
      </div>
      <p className="hidden text-body text-ink print:block">
        Printing is turned off for view-only documents.
      </p>
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-2xl bg-surface-deep px-4 py-12 text-center ring-1 ring-ink/10"
    >
      {children}
    </div>
  );
}

type ReadyModel = Extract<DocumentPagesModel, { status: 'ready' }>;

function ReadyViewer({
  pages: model,
  title,
  jumpTo,
  onPageChange,
}: {
  pages: ReadyModel;
  title: string;
  jumpTo: PageViewerProps['jumpTo'];
  onPageChange?: (page: number) => void;
}) {
  const { pages, totalPages, refresh } = model;
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [zoomIndex, setZoomIndex] = useState<number>(ZOOM_STEPS.indexOf(1));
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  /** Where the Fullscreen API is missing (iPhone Safari): the viewer covers the window. */
  const [expanded, setExpanded] = useState(false);
  const fullscreen = nativeFullscreen || expanded;
  const zoom = ZOOM_STEPS[zoomIndex]!;
  const last = pages.length;

  const pageElement = useCallback(
    (n: number) => scrollEl?.querySelector<HTMLElement>(`[data-page="${n}"]`) ?? null,
    [scrollEl],
  );

  const goTo = useCallback(
    (n: number, smooth = true) => {
      const target = Math.min(Math.max(1, n), last);
      const el = pageElement(target);
      if (!scrollEl || !el) return;
      scrollEl.scrollTo({
        top: el.offsetTop - 12,
        behavior: smooth && !reducedMotion ? 'smooth' : 'auto',
      });
      setCurrent(target);
      setPageInput(String(target));
    },
    [last, pageElement, scrollEl, reducedMotion],
  );

  // The current page is the one at the top third of the scroll area.
  useEffect(() => {
    if (!scrollEl) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const line = scrollEl.scrollTop + scrollEl.clientHeight / 3;
        const atBottom =
          scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 2 &&
          scrollEl.scrollTop > 0;
        let found = 1;
        for (const el of scrollEl.querySelectorAll<HTMLElement>('[data-page]')) {
          if (el.offsetTop <= line) found = Number(el.dataset.page);
          else break;
        }
        // The last pages can never reach the top third: scrolled to the end is the last page.
        if (atBottom) found = last;
        setCurrent(found);
        setPageInput(String(found));
      });
    };
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scrollEl.removeEventListener('scroll', onScroll);
    };
  }, [scrollEl, last]);

  // A jump asked from outside (contents, search, ?page=): the first one lands without
  // animation, later ones scroll smoothly. Waits for the scroll area to exist.
  const jumpNonce = jumpTo?.nonce;
  const jumpPage = jumpTo?.page;
  const handledJump = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (jumpPage === undefined || jumpNonce === undefined || !scrollEl) return;
    if (handledJump.current === jumpNonce) return;
    handledJump.current = jumpNonce;
    goTo(jumpPage, jumpNonce !== 0);
  }, [jumpNonce, jumpPage, scrollEl, goTo]);

  useEffect(() => {
    onPageChange?.(current);
  }, [current, onPageChange]);

  // Zooming and full screen keep the page you were on in view, once the layout has changed.
  const keepPage = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (keepPage.current === null) return;
    goTo(keepPage.current, false);
    keepPage.current = null;
  }, [zoom, fullscreen, goTo]);

  useEffect(() => {
    const onChange = () => {
      keepPage.current = current;
      setNativeFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [current]);

  // The window-covering fallback: no page scroll behind it, and Esc closes it.
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setExpanded(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [expanded]);

  function toggleFullscreen() {
    keepPage.current = current;
    if (fullscreen) {
      if (document.fullscreenElement) void document.exitFullscreen();
      setExpanded(false);
      return;
    }
    const root = rootRef.current;
    if (root?.requestFullscreen && document.fullscreenEnabled) {
      root.requestFullscreen().catch(() => setExpanded(true));
    } else {
      setExpanded(true);
    }
  }

  function setZoom(index: number) {
    keepPage.current = current;
    setZoomIndex(Math.min(Math.max(0, index), ZOOM_STEPS.length - 1));
  }
  const zoomBy = (step: number) => setZoom(zoomIndex + step);

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowRight') goTo(current + 1);
    else if (event.key === 'ArrowLeft') goTo(current - 1);
    else if (event.key === '+' || event.key === '=') zoomBy(1);
    else if (event.key === '-') zoomBy(-1);
    else return;
    event.preventDefault();
  }

  function commitPageInput() {
    const n = Number.parseInt(pageInput, 10);
    if (Number.isFinite(n)) goTo(n);
    else setPageInput(String(current));
  }

  return (
    <div
      ref={rootRef}
      onContextMenu={preventSave}
      onDragStart={preventSave}
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl bg-surface-deep ring-1 ring-ink/10 select-none [-webkit-touch-callout:none]',
        fullscreen && 'fixed inset-0 z-50 h-dvh rounded-none pt-safe pb-safe',
      )}
    >
      <div
        role="toolbar"
        aria-label="Preview controls"
        className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-ink/10 bg-white px-2 py-1"
      >
        <div className="flex items-center">
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={() => goTo(current - 1)}
            disabled={current <= 1}
            aria-label="Previous page"
          >
            <ChevronUp aria-hidden="true" className="size-5" />
          </button>
          <label className="flex items-center gap-2 px-1 text-small text-ink">
            <span>Page</span>
            <input
              type="text"
              inputMode="numeric"
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ''))}
              onBlur={commitPageInput}
              onKeyDown={(event) => event.key === 'Enter' && commitPageInput()}
              aria-label={`Page number, 1 to ${last}`}
              className="h-11 w-14 rounded-lg bg-surface text-center text-body text-ink ring-1 ring-ink/15"
            />
            <span className="whitespace-nowrap">of {last}</span>
          </label>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={() => goTo(current + 1)}
            disabled={current >= last}
            aria-label="Next page"
          >
            <ChevronDown aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={() => zoomBy(-1)}
            disabled={zoomIndex === 0}
            aria-label="Zoom out"
          >
            <Minus aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            className="min-h-11 min-w-16 cursor-pointer rounded-full px-2 text-small font-medium text-ink tabular-nums hover:bg-surface focus-visible:bg-surface"
            onClick={() => setZoom(ZOOM_STEPS.indexOf(1))}
            aria-label={`Zoom ${Math.round(zoom * 100)}%. Reset to fit the width`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={() => zoomBy(1)}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            aria-label="Zoom in"
          >
            <Plus aria-hidden="true" className="size-5" />
          </button>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            aria-pressed={fullscreen}
          >
            {fullscreen ? (
              <Minimize2 aria-hidden="true" className="size-5" />
            ) : (
              <Maximize2 aria-hidden="true" className="size-5" />
            )}
          </button>
        </div>
      </div>

      <div
        ref={setScrollEl}
        role="region"
        aria-label={`Pages of ${title}. Arrow keys change the page, plus and minus zoom.`}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className={cn(
          'relative overflow-auto overscroll-contain p-3 sm:p-4',
          // Toolbar and pages fit under the sticky header together (the toolbar wraps on phones).
          fullscreen
            ? 'min-h-0 flex-1'
            : 'h-[min(calc(100dvh-var(--header-h)-8rem),56rem)] min-h-80',
        )}
      >
        <div
          className="mx-auto flex flex-col items-center gap-3"
          style={{ width: `calc(min(100%, 56rem) * ${zoom})` }}
        >
          {pages.map((page) => (
            <PageImage key={page.number} page={page} root={scrollEl} onFailed={refresh} />
          ))}
        </div>
        {totalPages > last ? (
          <p className="mx-auto mt-4 max-w-prose text-center text-small text-ink-muted">
            The preview shows the first {last} of {totalPages} pages.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One page: its space is reserved from its size, and the image is only mounted while it is
 * near the visible area. It keeps the signed link it first loaded with, so a renewed token
 * never reloads a page already on screen; a link that fails (expired) asks for a new one.
 */
function PageImage({
  page,
  root,
  onFailed,
}: {
  page: ViewerPage;
  root: HTMLElement | null;
  onFailed: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  /** The link this page loaded with: kept, so a renewed token does not reload it. */
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = loadedSrc ?? (page.src === failedSrc ? null : page.src);
  const loaded = src !== null && src === loadedSrc;

  useEffect(() => {
    const el = ref.current;
    if (!el || !root) return;
    const observer = new IntersectionObserver(([entry]) => setNear(!!entry?.isIntersecting), {
      root,
      rootMargin: '150% 0px',
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [root]);

  return (
    <div
      ref={ref}
      data-page={page.number}
      className="relative w-full overflow-hidden bg-white shadow-sm ring-1 ring-ink/10"
      style={{ aspectRatio: `${page.width} / ${page.height}` }}
    >
      {near && src ? (
        <img
          src={src}
          alt={`Page ${page.number}`}
          width={page.width}
          height={page.height}
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedSrc(src)}
          onError={() => {
            setFailedSrc(src);
            setLoadedSrc(null);
            onFailed();
          }}
          className="pointer-events-none absolute inset-0 size-full"
        />
      ) : null}
      {!loaded || !near ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center text-small text-ink-muted"
        >
          Page {page.number}
        </span>
      ) : null}
    </div>
  );
}
