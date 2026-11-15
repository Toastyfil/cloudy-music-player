import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { CloudyMark } from './Logo';

export function SectionHeader({
  title,
  action,
  className,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-baseline justify-between gap-4', className)}>
      <h2 className="text-[19px] font-semibold tracking-[-0.01em]">{title}</h2>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon = true,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: boolean;
}) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 px-6 text-center">
      {icon ? <CloudyMark size={56} animated /> : null}
      <div className="space-y-1.5">
        <p className="text-[15px] font-medium text-text">{title}</p>
        {description ? <p className="mx-auto max-w-[320px] text-[13px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface', className)} />;
}

export function TrackListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-14 items-center gap-3 px-3">
          <Skeleton className="h-10 w-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-[38%]" />
            <Skeleton className="h-2.5 w-[22%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CardGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6', className)}>{children}</div>
  );
}

export function HorizontalScroller({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-6', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'relative -mb-px pb-2.5 pt-1 text-[13.5px] transition-colors duration-200 focus-ring',
            value === tab.id ? 'text-text' : 'text-muted hover:text-text/85',
          )}
        >
          {tab.label}
          <span
            className={cn(
              'absolute inset-x-0 -bottom-px h-[2px] rounded-full transition-all duration-200',
              value === tab.id ? 'bg-accent opacity-100' : 'opacity-0',
            )}
          />
        </button>
      ))}
    </div>
  );
}
