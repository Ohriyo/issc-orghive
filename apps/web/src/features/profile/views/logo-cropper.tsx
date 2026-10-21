import { useId, useRef, useState, type PointerEvent } from 'react';
import { Dialog } from 'radix-ui';
import { Minus, Plus } from 'lucide-react';
import { HexFrame } from '@/components/hex-frame';
import { PillButton } from '@/components/pill-button';
import {
  clampCrop,
  cropAfterKey,
  drawnSize,
  exportCrop,
  INITIAL_CROP,
  MAX_ZOOM,
  MIN_ZOOM,
  type CropState,
} from '../presenters/logo-crop';
import type { PendingLogo } from '../presenters/use-profile-editor';

export interface LogoCropperProps {
  logo: PendingLogo | null;
  acronym: string;
  onAccept: (blob: Blob) => void;
  onCancel: () => void;
}

/**
 * Fits a new logo to the HexFrame. The frame itself is the stage: what shows inside the
 * hexagon is exactly what will be saved. Drag (mouse or touch) or the arrow keys move it,
 * the slider, the wheel or +/- zoom it; it starts with the whole logo visible.
 */
export function LogoCropper({ logo, acronym, onAccept, onCancel }: LogoCropperProps) {
  return (
    <Dialog.Root open={logo !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/40 duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[60] max-h-[92dvh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl bg-white p-5 shadow-pool-lift duration-300 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none md:p-8">
          <Dialog.Title className="text-h3 font-bold text-ink">Fit the logo to the hexagon</Dialog.Title>
          <Dialog.Description className="mt-2 text-body text-ink-muted">
            Drag the logo, or use the arrow keys, to place it. Zoom in to leave out empty edges.
          </Dialog.Description>
          {logo ? (
            <CropStage key={logo.url} logo={logo} acronym={acronym} onAccept={onAccept} onCancel={onCancel} />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CropStage({
  logo,
  acronym,
  onAccept,
  onCancel,
}: {
  logo: PendingLogo;
  acronym: string;
  onAccept: (blob: Blob) => void;
  onCancel: () => void;
}) {
  const natural = { width: logo.width, height: logo.height };
  const [crop, setCrop] = useState<CropState>(INITIAL_CROP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; start: CropState } | null>(null);
  const zoomId = useId();
  const helpId = useId();
  const size = drawnSize(natural, crop.zoom);

  const update = (next: CropState) => setCrop(clampCrop(next, natural));

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, start: crop };
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    const width = stage.current?.clientWidth;
    if (!start || !width) return;
    update({
      ...start.start,
      x: start.start.x + (event.clientX - start.x) / width,
      y: start.start.y + (event.clientY - start.y) / width,
    });
  }
  const endDrag = () => {
    drag.current = null;
  };

  async function accept() {
    if (!image.current) return;
    setBusy(true);
    setError(undefined);
    try {
      onAccept(await exportCrop(image.current, natural, crop));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This image could not be cropped.');
      setBusy(false);
    }
  }

  return (
    <>
      <HexFrame className="mx-auto mt-6 w-[min(100%,20rem)]" contentClassName="p-[16%]">
        <div
          ref={stage}
          role="group"
          tabIndex={0}
          aria-label={`${acronym} logo position`}
          aria-describedby={helpId}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={(event) => update({ ...crop, zoom: crop.zoom - event.deltaY * 0.0015 })}
          onKeyDown={(event) => {
            const next = cropAfterKey(crop, event.key, event.shiftKey, natural);
            if (!next) return;
            event.preventDefault();
            setCrop(next);
          }}
          className="@container relative aspect-square h-full cursor-grab touch-none overflow-hidden rounded-[2px] outline-offset-4 select-none focus-visible:outline-2 focus-visible:outline-white active:cursor-grabbing"
        >
          <img
            ref={image}
            src={logo.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-1/2 left-1/2 max-w-none"
            style={{
              width: `${size.width * 100}%`,
              height: `${size.height * 100}%`,
              transform: `translate(calc(-50% + ${crop.x * 100}cqw), calc(-50% + ${crop.y * 100}cqw))`,
            }}
          />
        </div>
      </HexFrame>
      <p id={helpId} className="sr-only">
        Arrow keys move the logo; hold Shift to move it further. Plus and minus zoom.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => update({ ...crop, zoom: crop.zoom - 0.25 })}
          aria-label="Zoom out"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-300 hover:bg-pill-light focus-visible:bg-pill-light"
        >
          <Minus aria-hidden="true" className="size-5" />
        </button>
        <label htmlFor={zoomId} className="sr-only">
          Zoom
        </label>
        <input
          id={zoomId}
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={crop.zoom}
          onChange={(event) => update({ ...crop, zoom: Number(event.target.value) })}
          className="h-11 min-w-0 flex-1 cursor-pointer accent-forest-700"
        />
        <button
          type="button"
          onClick={() => update({ ...crop, zoom: crop.zoom + 0.25 })}
          aria-label="Zoom in"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-300 hover:bg-pill-light focus-visible:bg-pill-light"
        >
          <Plus aria-hidden="true" className="size-5" />
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-4 text-small font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <PillButton variant="light" onClick={onCancel} disabled={busy}>
          Cancel
        </PillButton>
        <PillButton onClick={() => void accept()} disabled={busy}>
          {busy ? 'Preparing…' : 'Use this logo'}
        </PillButton>
      </div>
    </>
  );
}
