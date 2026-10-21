// Per-row status in the "Map to body types" pickers: how many of the selected
// items are already on that body type. Renders nothing until the mapping loads.
export function MappedBadge({
  mapping,
  selectedIds,
  noun,
}: {
  mapping: { explicit: boolean; ids: Set<string> } | undefined;
  selectedIds: string[];
  noun: string;
}) {
  if (!mapping || selectedIds.length === 0) return null;
  if (!mapping.explicit) {
    return (
      <span className="badge" style={{ fontSize: 10 }}>
        shows all {noun}s
      </span>
    );
  }
  const mapped = selectedIds.filter((id) => mapping.ids.has(id)).length;
  return (
    <span
      className={mapped === selectedIds.length ? 'badge dot accent' : 'badge'}
      style={{ fontSize: 10 }}
    >
      {mapped === selectedIds.length
        ? `all ${mapped} already mapped`
        : `${mapped}/${selectedIds.length} already mapped`}
    </span>
  );
}

// Grid-card chip: the body types an item is explicitly mapped to. Zero is flagged
// because an unmapped item is hidden on every body type that has been curated.
export function BodyTypesChip({ labels }: { labels: string[] | undefined }) {
  if (!labels) return null;
  const title =
    labels.length === 0
      ? 'Not mapped to any body type — hidden on body types that have explicit mappings'
      : `Mapped to: ${labels.join(', ')}`;
  return (
    <span
      className={labels.length === 0 ? 'badge' : 'badge dot accent'}
      style={{ fontSize: 10 }}
      title={title}
    >
      {labels.length === 1 ? labels[0] : `${labels.length} body types`}
    </span>
  );
}
