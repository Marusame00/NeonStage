import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface FitStageProps {
  width: number;
  height: number;
  fit: 'contain' | 'none';
  onScale?(scale: number): void;
  children: ReactNode;
}

function initialSize(): { w: number; h: number } {
  if (typeof window === 'undefined') return { w: 0, h: 0 };
  return { w: window.innerWidth, h: window.innerHeight };
}

export function FitStage({ width, height, fit, onScale, children }: FitStageProps): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(initialSize);

  useEffect(() => {
    const host = hostRef.current;
    const measure = (): void => {
      const rect = host?.getBoundingClientRect();
      setSize({
        w: rect && rect.width > 0 ? rect.width : window.innerWidth,
        h: rect && rect.height > 0 ? rect.height : window.innerHeight,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (host && observer) observer.observe(host);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  const scale =
    fit === 'none' || width <= 0 || height <= 0 || size.w <= 0 || size.h <= 0
      ? 1
      : Math.min(size.w / width, size.h / height);

  useEffect(() => {
    onScale?.(scale);
  }, [onScale, scale]);

  const left = fit === 'none' ? 0 : (size.w - width * scale) / 2;
  const top = fit === 'none' ? 0 : (size.h - height * scale) / 2;

  return (
    <div
      ref={hostRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: 'transparent',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left,
          top,
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          background: 'transparent',
        }}
      >
        {children}
      </div>
    </div>
  );
}
