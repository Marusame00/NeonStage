import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: string;
  label: string;
  active?: boolean;
  size?: number;
}

export function IconButton({
  icon,
  label,
  active = false,
  size = 16,
  className,
  type = 'button',
  ...rest
}: IconButtonProps): ReactNode {
  return (
    <button
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={['ns-iconbtn', active ? 'is-active' : '', className].filter(Boolean).join(' ')}
      {...rest}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path
          d={icon}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
