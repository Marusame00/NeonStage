import type { ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange(id: string): void;
}

export function Tabs({ tabs, active, onChange }: TabsProps): ReactNode {
  return (
    <div className="ns-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === active}
          className={['ns-tab', tab.id === active ? 'is-active' : ''].filter(Boolean).join(' ')}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
