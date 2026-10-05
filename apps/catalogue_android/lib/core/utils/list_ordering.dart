/// Reorders [items] so any whose id (via [idOf]) is in [selectedIds] come
/// first — in their original relative order — followed by everything else.
///
/// Used by the Catalogue Studio picker rows (Model, Background, Poses,
/// Lower Garment, Footwear): each row only shows the first few items plus a
/// "More" tile that opens the full list in a bottom sheet. Without this, a
/// selection made from that sheet could land outside the visible slots —
/// the row would look unchanged and the user's pick wouldn't be visible
/// until they reopened "More". Reordering keeps every current selection in
/// the always-visible part of the row.
List<T> withSelectedFirst<T>(
  List<T> items,
  String Function(T item) idOf,
  Set<String> selectedIds,
) {
  if (selectedIds.isEmpty) return items;
  final selected = <T>[];
  final rest = <T>[];
  for (final item in items) {
    if (selectedIds.contains(idOf(item))) {
      selected.add(item);
    } else {
      rest.add(item);
    }
  }
  return [...selected, ...rest];
}
