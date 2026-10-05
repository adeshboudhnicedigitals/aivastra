import 'package:freezed_annotation/freezed_annotation.dart';

part 'catalog_node.freezed.dart';
part 'catalog_node.g.dart';

@freezed
abstract class CatalogItem with _$CatalogItem {
  const factory CatalogItem({
    required String id,
    required String label,
    required String thumbnailUrl,
    // type/genderSlug/categoryId are all nullable — none of them are
    // present on a *categorized* item at all. apps/api/src/modules/catalog/
    // tree.ts's buildTree() maps each item down to exactly
    // {id, label, thumbnailUrl} once it's inside a category node; the full
    // raw row (type, genderSlug, categoryId, r2Key, ...) only comes through
    // for the synthetic 'other' (uncategorized) bucket. These fields were
    // wrongly `required` — the moment any real category (e.g. "Mini
    // skirts", "Ballet flats") had items, parsing that node's items threw,
    // the whole /v1/catalog/:type response's JSON parse failed, the
    // provider silently landed in an error state, and the UI's `.value ??
    // []` fallback rendered that as an empty list with no visible error —
    // this is why Lower Garment/Footwear appeared empty even though the
    // server was returning real data (confirmed via device log: the
    // response body had "mini-skirts"/"ballet-flats" categories with real
    // items, but the app showed nothing).
    String? type,
    String? genderSlug,
    int? categoryId,
    @Default(true) bool isActive,
  }) = _CatalogItem;

  factory CatalogItem.fromJson(Map<String, dynamic> json) =>
      _$CatalogItemFromJson(json);
}

@freezed
abstract class CatalogNode with _$CatalogNode {
  const factory CatalogNode({
    required int id,
    required String slug,
    required String label,
    String? thumbnailUrl,
    @Default([]) List<CatalogNode> children,
    @Default([]) List<CatalogItem> items,
  }) = _CatalogNode;

  factory CatalogNode.fromJson(Map<String, dynamic> json) =>
      _$CatalogNodeFromJson(json);
}

@freezed
abstract class CatalogTree with _$CatalogTree {
  const factory CatalogTree({
    required String type,
    required List<CatalogNode> tree,
  }) = _CatalogTree;

  factory CatalogTree.fromJson(Map<String, dynamic> json) =>
      _$CatalogTreeFromJson(json);
}
