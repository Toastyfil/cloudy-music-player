import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Distance the pointer has to travel before a press turns into a drag. */
const THRESHOLD = 5;

/**
 * Reorder-with-the-pointer for a vertical icon rail or list of rows.
 *
 * HTML5 drag events are unreliable under Electron's frameless windows, so this
 * reads pointer positions directly: press an item, move a few pixels, and it
 * slides to whatever item the pointer is over. A press that never crosses the
 * threshold stays a normal click, so the same element can still be a link or a
 * track row.
 */
export function useDragOrder(ids: string[], onCommit: (order: string[], movedId: string | null) => void) {
  const [order, setOrder] = useState<string[]>(ids);
  const [dragging, setDragging] = useState<string | null>(null);
  const orderRef = useRef(ids);
  const pressed = useRef<{ id: string; x: number; y: number } | null>(null);
  const active = useRef<string | null>(null);
  const dragged = useRef(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // The caller owns the stored order: when it changes (first load, a reset, a
  // new playlist) the list adopts it. A drag in progress is left alone because
  // it only commits on drop, which is what changes the caller's order.
  const signature = ids.join('|');
  useEffect(() => {
    if (dragging) return;
    orderRef.current = ids;
    setOrder(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const apply = (next: string[]) => {
    orderRef.current = next;
    setOrder(next);
  };

  useEffect(() => {
    if (!dragging) return;
    const targetAt = (event: PointerEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      return (element?.closest('[data-drag-id]') as HTMLElement | null)?.dataset.dragId ?? null;
    };
    const move = (event: PointerEvent) => {
      const source = active.current;
      const target = targetAt(event);
      if (!source || !target || target === source) return;
      const next = [...orderRef.current];
      const from = next.indexOf(source);
      const to = next.indexOf(target);
      if (from < 0 || to < 0) return;
      next.splice(from, 1);
      next.splice(to, 0, source);
      apply(next);
    };
    const finish = () => {
      const source = active.current;
      active.current = null;
      setDragging(null);
      document.body.style.cursor = '';
      if (source) commitRef.current(orderRef.current, source);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [dragging]);

  const bind = (id: string) => ({
    'data-drag-id': id,
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      pressed.current = { id, x: event.clientX, y: event.clientY };
      dragged.current = false;
      const maybeStart = (moveEvent: PointerEvent) => {
        const start = pressed.current;
        if (!start) return;
        if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < THRESHOLD) return;
        pressed.current = null;
        active.current = start.id;
        dragged.current = true;
        setDragging(start.id);
        document.body.style.cursor = 'grabbing';
        window.removeEventListener('pointermove', maybeStart);
      };
      const cancel = () => {
        pressed.current = null;
        window.removeEventListener('pointermove', maybeStart);
        window.removeEventListener('pointerup', cancel, true);
      };
      window.addEventListener('pointermove', maybeStart);
      window.addEventListener('pointerup', cancel, true);
    },
    // Swallow the click that ends a drag so it never navigates or starts a track.
    onClickCapture: (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!dragged.current) return;
      dragged.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  });

  return { order, dragging, bind };
}
