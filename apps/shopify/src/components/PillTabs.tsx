import type { ReactNode } from 'react';

export interface PillTab {
  id: string;
  content: string;
  disabled?: boolean;
  icon?: ReactNode;
}

/** Rounded pill tab strip; stands in for Polaris Tabs (the panel is rendered by the caller). */
export function PillTabs({
  tabs,
  selected,
  onSelect,
  boxed = false,
  underline = false,
  label,
}: {
  tabs: readonly PillTab[];
  selected: number;
  onSelect: (index: number) => void;
  /** A white tray around the strip, for tabs that sit in the page header. */
  boxed?: boolean;
  /** Icon + underline tabs spanning the page, per the v2 Settings design. */
  underline?: boolean;
  label: string;
}) {
  return (
    <div
      className={`av-pilltabs${boxed ? ' boxed' : ''}${underline ? ' underline' : ''}`}
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={index === selected}
          disabled={tab.disabled}
          className={`av-pilltab${index === selected ? ' on' : ''}`}
          onClick={() => onSelect(index)}
        >
          {tab.icon}
          {tab.content}
        </button>
      ))}
    </div>
  );
}
