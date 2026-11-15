import { AnimatePresence, motion } from 'framer-motion';
import { MoreVertical, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/lib/cn';

export type MenuItem = {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
};

/** Small popover menu used by every list row, anchored to its trigger. */
export function RowMenu({ items, label = 'More options' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 210;
    const menuHeight = items.length * 34 + 12;
    let left = rect.right - menuWidth;
    let top = rect.bottom + 6;
    if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - 6);
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));
    setPosition({ top, left });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      if (triggerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-full text-faint transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-ring',
          open && 'bg-surface-hover text-text',
        )}
      >
        <MoreVertical size={16} strokeWidth={2} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -2 }}
              transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              style={{ top: position.top, left: position.left }}
              className="fixed z-[80] w-[210px] overflow-hidden rounded-xl border border-line bg-[color:var(--bg-elevated)] p-1.5 shadow-[var(--shadow)]"
              onClick={(event) => event.stopPropagation()}
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-150',
                    item.danger ? 'text-red-400 hover:bg-red-500/10' : 'text-text/85 hover:bg-surface hover:text-text',
                    item.disabled && 'cursor-not-allowed opacity-40',
                  )}
                >
                  {item.icon ? <item.icon size={15} /> : <span className="w-[15px]" />}
                  {item.label}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
