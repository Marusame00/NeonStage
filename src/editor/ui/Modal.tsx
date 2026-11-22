import { useEffect, type ReactNode } from 'react';
import { IconButton } from './IconButton';

export interface ModalProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  className?: string;
}

const CLOSE_ICON = 'M6 6l12 12M18 6L6 18';

export function Modal({ title, onClose, children, className }: ModalProps): ReactNode {
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [onClose]);

  return (
    <div
      className="ns-modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={['ns-modal', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-no-shortcuts
      >
        <header className="ns-modal-head">
          <h2>{title}</h2>
          <IconButton icon={CLOSE_ICON} label="Close" onClick={onClose} />
        </header>
        <div className="ns-modal-body">{children}</div>
      </div>
    </div>
  );
}
