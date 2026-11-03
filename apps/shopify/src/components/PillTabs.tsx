export interface PillTab {
  id: string;
  content: string;
  disabled?: boolean;
}

/** Rounded pill tab strip; stands in for Polaris Tabs (the panel is rendered by the caller). */
export function PillTabs({
  tabs,
  selected,
  onSelect,
  boxed = false,
  label,
}: {
  tabs: readonly PillTab[];
  selected: number;
  onSelect: (index: number) => void;
  /** A white tray around the strip, for tabs that sit in the page header. */
  boxed?: boolean;
  label: string;
}) {
  return (
    <div className={`av-pilltabs${boxed ? ' boxed' : ''}`} role="tablist" aria-label={label}>
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
          {tab.content}
        </button>
      ))}
    </div>
  );
}
