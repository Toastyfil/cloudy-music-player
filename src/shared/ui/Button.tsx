import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/shared/lib/cn';

type Variant = 'primary' | 'ghost' | 'subtle' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-black font-semibold hover:brightness-110 active:brightness-95',
  ghost: 'text-text/80 hover:text-text hover:bg-surface',
  subtle: 'bg-surface text-text hover:bg-surface-hover',
  outline: 'border border-line text-text hover:bg-surface',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-full gap-1.5',
  md: 'h-9 px-4 text-sm rounded-full gap-2',
  lg: 'h-11 px-6 text-sm rounded-full gap-2',
  icon: 'h-8 w-8 rounded-[var(--icon-radius,9999px)] justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex select-none items-center transition-[background,color,filter,transform] duration-200 focus-ring disabled:cursor-not-allowed disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(
  function IconButton({ className, label, ...props }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors duration-200 hover:bg-surface hover:text-text focus-ring disabled:opacity-35 [&>svg]:transition-transform [&>svg]:duration-150 hover:[&>svg]:scale-105 active:[&>svg]:scale-95',
          className,
        )}
        {...props}
      />
    );
  },
);
