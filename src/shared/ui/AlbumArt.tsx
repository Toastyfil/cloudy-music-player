import { Music2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Cover art with Cloudy's note mark as the fallback — never a broken image,
 * never a grey box.
 */
export function AlbumArt({
  src,
  alt = '',
  size = 48,
  rounded = 'md',
  className,
}: {
  src?: string | null;
  alt?: string;
  size?: number;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const radius = { sm: 6, md: 8, lg: 12, xl: 16, full: 999 }[rounded];

  return (
    <span
      className={cn('relative block shrink-0 overflow-hidden bg-surface', className)}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center bg-surface text-faint">
          <Music2 size={Math.max(14, Math.round(size * 0.34))} strokeWidth={1.6} />
        </span>
      )}
    </span>
  );
}
