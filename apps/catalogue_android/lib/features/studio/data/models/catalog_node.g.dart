// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'catalog_node.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_CatalogItem _$CatalogItemFromJson(Map<String, dynamic> json) => _CatalogItem(
  id: json['id'] as String,
  label: json['label'] as String,
  thumbnailUrl: json['thumbnailUrl'] as String,
  type: json['type'] as String?,
  genderSlug: json['genderSlug'] as String?,
  categoryId: (json['categoryId'] as num?)?.toInt(),
  isActive: json['isActive'] as bool? ?? true,
);

Map<String, dynamic> _$CatalogItemToJson(_CatalogItem instance) =>
    <String, dynamic>{
      'id': instance.id,
      'label': instance.label,
      'thumbnailUrl': instance.thumbnailUrl,
      'type': instance.type,
      'genderSlug': instance.genderSlug,
      'categoryId': instance.categoryId,
      'isActive': instance.isActive,
    };

_CatalogNode _$CatalogNodeFromJson(Map<String, dynamic> json) => _CatalogNode(
  id: (json['id'] as num).toInt(),
  slug: json['slug'] as String,
  label: json['label'] as String,
  thumbnailUrl: json['thumbnailUrl'] as String?,
  children:
      (json['children'] as List<dynamic>?)
          ?.map((e) => CatalogNode.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
  items:
      (json['items'] as List<dynamic>?)
          ?.map((e) => CatalogItem.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

Map<String, dynamic> _$CatalogNodeToJson(_CatalogNode instance) =>
    <String, dynamic>{
      'id': instance.id,
      'slug': instance.slug,
      'label': instance.label,
      'thumbnailUrl': instance.thumbnailUrl,
      'children': instance.children,
      'items': instance.items,
    };

_CatalogTree _$CatalogTreeFromJson(Map<String, dynamic> json) => _CatalogTree(
  type: json['type'] as String,
  tree: (json['tree'] as List<dynamic>)
      .map((e) => CatalogNode.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$CatalogTreeToJson(_CatalogTree instance) =>
    <String, dynamic>{'type': instance.type, 'tree': instance.tree};
