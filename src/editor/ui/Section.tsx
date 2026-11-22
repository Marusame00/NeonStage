import { useState, type ReactNode } from 'react';

export interface SectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}

export function Section({ title, children, defaultOpen = true, actions }: SectionProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={['ns-section', open ? 'is-open' : ''].filter(Boolean).join(' ')}>
      <header className="ns-section-head">
        <button type="button" className="ns-section-toggle" onClick={() => setOpen(!open)}>
          <svg viewBox="0 0 24 24" width={12} height={12} aria-hidden="true">
            <path
              d={open ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{title}</span>
        </button>
        {actions ? <div className="ns-section-actions">{actions}</div> : null}
      </header>
      {open ? <div className="ns-section-body">{children}</div> : null}
    </section>
  );
}
