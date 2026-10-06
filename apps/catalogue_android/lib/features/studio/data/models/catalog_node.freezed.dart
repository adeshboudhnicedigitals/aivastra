// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'catalog_node.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$CatalogItem {

 String get id; String get label; String get thumbnailUrl; String? get type; String? get genderSlug; int? get categoryId; bool get isActive;
/// Create a copy of CatalogItem
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogItemCopyWith<CatalogItem> get copyWith => _$CatalogItemCopyWithImpl<CatalogItem>(this as CatalogItem, _$identity);

  /// Serializes this CatalogItem to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogItem;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogItem&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl)&&(identical(other.type, _this.type) || other.type == _this.type)&&(identical(other.genderSlug, _this.genderSlug) || other.genderSlug == _this.genderSlug)&&(identical(other.categoryId, _this.categoryId) || other.categoryId == _this.categoryId)&&(identical(other.isActive, _this.isActive) || other.isActive == _this.isActive));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogItem;
  return Object.hash(runtimeType,_this.id,_this.label,_this.thumbnailUrl,_this.type,_this.genderSlug,_this.categoryId,_this.isActive);
}

@override
String toString() {
  final _this = this as CatalogItem;
  return 'CatalogItem(id: ${_this.id}, label: ${_this.label}, thumbnailUrl: ${_this.thumbnailUrl}, type: ${_this.type}, genderSlug: ${_this.genderSlug}, categoryId: ${_this.categoryId}, isActive: ${_this.isActive})';
}


}

/// @nodoc
abstract mixin class $CatalogItemCopyWith<$Res>  {
  factory $CatalogItemCopyWith(CatalogItem value, $Res Function(CatalogItem) _then) = _$CatalogItemCopyWithImpl;
@useResult
$Res call({
 String id, String label, String thumbnailUrl, String? type, String? genderSlug, int? categoryId, bool isActive
});




}
/// @nodoc
class _$CatalogItemCopyWithImpl<$Res>
    implements $CatalogItemCopyWith<$Res> {
  _$CatalogItemCopyWithImpl(this._self, this._then);

  final CatalogItem _self;
  final $Res Function(CatalogItem) _then;

/// Create a copy of CatalogItem
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? label = null,Object? thumbnailUrl = null,Object? type = freezed,Object? genderSlug = freezed,Object? categoryId = freezed,Object? isActive = null,}) {
  return _then(CatalogItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,type: freezed == type ? _self.type : type // ignore: cast_nullable_to_non_nullable
as String?,genderSlug: freezed == genderSlug ? _self.genderSlug : genderSlug // ignore: cast_nullable_to_non_nullable
as String?,categoryId: freezed == categoryId ? _self.categoryId : categoryId // ignore: cast_nullable_to_non_nullable
as int?,isActive: null == isActive ? _self.isActive : isActive // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogItem].
extension CatalogItemPatterns on CatalogItem {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogItem value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogItem() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogItem value)  $default,){
final _that = this;
switch (_that) {
case _CatalogItem():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogItem value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogItem() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String label,  String thumbnailUrl,  String? type,  String? genderSlug,  int? categoryId,  bool isActive)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogItem() when $default != null:
return $default(_that.id,_that.label,_that.thumbnailUrl,_that.type,_that.genderSlug,_that.categoryId,_that.isActive);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String label,  String thumbnailUrl,  String? type,  String? genderSlug,  int? categoryId,  bool isActive)  $default,) {final _that = this;
switch (_that) {
case _CatalogItem():
return $default(_that.id,_that.label,_that.thumbnailUrl,_that.type,_that.genderSlug,_that.categoryId,_that.isActive);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String label,  String thumbnailUrl,  String? type,  String? genderSlug,  int? categoryId,  bool isActive)?  $default,) {final _that = this;
switch (_that) {
case _CatalogItem() when $default != null:
return $default(_that.id,_that.label,_that.thumbnailUrl,_that.type,_that.genderSlug,_that.categoryId,_that.isActive);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogItem implements CatalogItem {
  const _CatalogItem({required this.id, required this.label, required this.thumbnailUrl, this.type, this.genderSlug, this.categoryId, this.isActive = true});
  factory _CatalogItem.fromJson(Map<String, dynamic> json) => _$CatalogItemFromJson(json);

@override final  String id;
@override final  String label;
@override final  String thumbnailUrl;
@override final  String? type;
@override final  String? genderSlug;
@override final  int? categoryId;
@override@JsonKey() final  bool isActive;

/// Create a copy of CatalogItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogItemCopyWith<_CatalogItem> get copyWith => __$CatalogItemCopyWithImpl<_CatalogItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogItem&&(identical(other.id, id) || other.id == id)&&(identical(other.label, label) || other.label == label)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl)&&(identical(other.type, type) || other.type == type)&&(identical(other.genderSlug, genderSlug) || other.genderSlug == genderSlug)&&(identical(other.categoryId, categoryId) || other.categoryId == categoryId)&&(identical(other.isActive, isActive) || other.isActive == isActive));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,label,thumbnailUrl,type,genderSlug,categoryId,isActive);
}

@override
String toString() {
    return 'CatalogItem(id: $id, label: $label, thumbnailUrl: $thumbnailUrl, type: $type, genderSlug: $genderSlug, categoryId: $categoryId, isActive: $isActive)';
}


}

/// @nodoc
abstract mixin class _$CatalogItemCopyWith<$Res> implements $CatalogItemCopyWith<$Res> {
  factory _$CatalogItemCopyWith(_CatalogItem value, $Res Function(_CatalogItem) _then) = __$CatalogItemCopyWithImpl;
@override @useResult
$Res call({
 String id, String label, String thumbnailUrl, String? type, String? genderSlug, int? categoryId, bool isActive
});




}
/// @nodoc
class __$CatalogItemCopyWithImpl<$Res>
    implements _$CatalogItemCopyWith<$Res> {
  __$CatalogItemCopyWithImpl(this._self, this._then);

  final _CatalogItem _self;
  final $Res Function(_CatalogItem) _then;

/// Create a copy of CatalogItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? label = null,Object? thumbnailUrl = null,Object? type = freezed,Object? genderSlug = freezed,Object? categoryId = freezed,Object? isActive = null,}) {
  return _then(_CatalogItem(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,type: freezed == type ? _self.type : type // ignore: cast_nullable_to_non_nullable
as String?,genderSlug: freezed == genderSlug ? _self.genderSlug : genderSlug // ignore: cast_nullable_to_non_nullable
as String?,categoryId: freezed == categoryId ? _self.categoryId : categoryId // ignore: cast_nullable_to_non_nullable
as int?,isActive: null == isActive ? _self.isActive : isActive // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}


/// @nodoc
mixin _$CatalogNode {

 int get id; String get slug; String get label; String? get thumbnailUrl; List<CatalogNode> get children; List<CatalogItem> get items;
/// Create a copy of CatalogNode
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogNodeCopyWith<CatalogNode> get copyWith => _$CatalogNodeCopyWithImpl<CatalogNode>(this as CatalogNode, _$identity);

  /// Serializes this CatalogNode to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogNode;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogNode&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.slug, _this.slug) || other.slug == _this.slug)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl)&&const DeepCollectionEquality().equals(other.children, _this.children)&&const DeepCollectionEquality().equals(other.items, _this.items));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogNode;
  return Object.hash(runtimeType,_this.id,_this.slug,_this.label,_this.thumbnailUrl,const DeepCollectionEquality().hash(_this.children),const DeepCollectionEquality().hash(_this.items));
}

@override
String toString() {
  final _this = this as CatalogNode;
  return 'CatalogNode(id: ${_this.id}, slug: ${_this.slug}, label: ${_this.label}, thumbnailUrl: ${_this.thumbnailUrl}, children: ${_this.children}, items: ${_this.items})';
}


}

/// @nodoc
abstract mixin class $CatalogNodeCopyWith<$Res>  {
  factory $CatalogNodeCopyWith(CatalogNode value, $Res Function(CatalogNode) _then) = _$CatalogNodeCopyWithImpl;
@useResult
$Res call({
 int id, String slug, String label, String? thumbnailUrl, List<CatalogNode> children, List<CatalogItem> items
});




}
/// @nodoc
class _$CatalogNodeCopyWithImpl<$Res>
    implements $CatalogNodeCopyWith<$Res> {
  _$CatalogNodeCopyWithImpl(this._self, this._then);

  final CatalogNode _self;
  final $Res Function(CatalogNode) _then;

/// Create a copy of CatalogNode
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? slug = null,Object? label = null,Object? thumbnailUrl = freezed,Object? children = null,Object? items = null,}) {
  return _then(CatalogNode(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,children: null == children ? _self.children : children // ignore: cast_nullable_to_non_nullable
as List<CatalogNode>,items: null == items ? _self.items : items // ignore: cast_nullable_to_non_nullable
as List<CatalogItem>,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogNode].
extension CatalogNodePatterns on CatalogNode {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogNode value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogNode() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogNode value)  $default,){
final _that = this;
switch (_that) {
case _CatalogNode():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogNode value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogNode() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int id,  String slug,  String label,  String? thumbnailUrl,  List<CatalogNode> children,  List<CatalogItem> items)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogNode() when $default != null:
return $default(_that.id,_that.slug,_that.label,_that.thumbnailUrl,_that.children,_that.items);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int id,  String slug,  String label,  String? thumbnailUrl,  List<CatalogNode> children,  List<CatalogItem> items)  $default,) {final _that = this;
switch (_that) {
case _CatalogNode():
return $default(_that.id,_that.slug,_that.label,_that.thumbnailUrl,_that.children,_that.items);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int id,  String slug,  String label,  String? thumbnailUrl,  List<CatalogNode> children,  List<CatalogItem> items)?  $default,) {final _that = this;
switch (_that) {
case _CatalogNode() when $default != null:
return $default(_that.id,_that.slug,_that.label,_that.thumbnailUrl,_that.children,_that.items);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogNode implements CatalogNode {
  const _CatalogNode({required this.id, required this.slug, required this.label, this.thumbnailUrl,  List<CatalogNode> children = const [],  List<CatalogItem> items = const []}): _children = children,_items = items;
  factory _CatalogNode.fromJson(Map<String, dynamic> json) => _$CatalogNodeFromJson(json);

@override final  int id;
@override final  String slug;
@override final  String label;
@override final  String? thumbnailUrl;
 final  List<CatalogNode> _children;
@override@JsonKey() List<CatalogNode> get children {
  if (_children is EqualUnmodifiableListView) return _children;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_children);
}

 final  List<CatalogItem> _items;
@override@JsonKey() List<CatalogItem> get items {
  if (_items is EqualUnmodifiableListView) return _items;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_items);
}


/// Create a copy of CatalogNode
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogNodeCopyWith<_CatalogNode> get copyWith => __$CatalogNodeCopyWithImpl<_CatalogNode>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogNodeToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogNode&&(identical(other.id, id) || other.id == id)&&(identical(other.slug, slug) || other.slug == slug)&&(identical(other.label, label) || other.label == label)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl)&&const DeepCollectionEquality().equals(other.children, _children)&&const DeepCollectionEquality().equals(other.items, _items));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,slug,label,thumbnailUrl,const DeepCollectionEquality().hash(_children),const DeepCollectionEquality().hash(_items));
}

@override
String toString() {
    return 'CatalogNode(id: $id, slug: $slug, label: $label, thumbnailUrl: $thumbnailUrl, children: $children, items: $items)';
}


}

/// @nodoc
abstract mixin class _$CatalogNodeCopyWith<$Res> implements $CatalogNodeCopyWith<$Res> {
  factory _$CatalogNodeCopyWith(_CatalogNode value, $Res Function(_CatalogNode) _then) = __$CatalogNodeCopyWithImpl;
@override @useResult
$Res call({
 int id, String slug, String label, String? thumbnailUrl, List<CatalogNode> children, List<CatalogItem> items
});




}
/// @nodoc
class __$CatalogNodeCopyWithImpl<$Res>
    implements _$CatalogNodeCopyWith<$Res> {
  __$CatalogNodeCopyWithImpl(this._self, this._then);

  final _CatalogNode _self;
  final $Res Function(_CatalogNode) _then;

/// Create a copy of CatalogNode
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? slug = null,Object? label = null,Object? thumbnailUrl = freezed,Object? children = null,Object? items = null,}) {
  return _then(_CatalogNode(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,children: null == children ? _self._children : children // ignore: cast_nullable_to_non_nullable
as List<CatalogNode>,items: null == items ? _self._items : items // ignore: cast_nullable_to_non_nullable
as List<CatalogItem>,
  ));
}


}


/// @nodoc
mixin _$CatalogTree {

 String get type; List<CatalogNode> get tree;
/// Create a copy of CatalogTree
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogTreeCopyWith<CatalogTree> get copyWith => _$CatalogTreeCopyWithImpl<CatalogTree>(this as CatalogTree, _$identity);

  /// Serializes this CatalogTree to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogTree;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogTree&&(identical(other.type, _this.type) || other.type == _this.type)&&const DeepCollectionEquality().equals(other.tree, _this.tree));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogTree;
  return Object.hash(runtimeType,_this.type,const DeepCollectionEquality().hash(_this.tree));
}

@override
String toString() {
  final _this = this as CatalogTree;
  return 'CatalogTree(type: ${_this.type}, tree: ${_this.tree})';
}


}

/// @nodoc
abstract mixin class $CatalogTreeCopyWith<$Res>  {
  factory $CatalogTreeCopyWith(CatalogTree value, $Res Function(CatalogTree) _then) = _$CatalogTreeCopyWithImpl;
@useResult
$Res call({
 String type, List<CatalogNode> tree
});




}
/// @nodoc
class _$CatalogTreeCopyWithImpl<$Res>
    implements $CatalogTreeCopyWith<$Res> {
  _$CatalogTreeCopyWithImpl(this._self, this._then);

  final CatalogTree _self;
  final $Res Function(CatalogTree) _then;

/// Create a copy of CatalogTree
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? type = null,Object? tree = null,}) {
  return _then(CatalogTree(
type: null == type ? _self.type : type // ignore: cast_nullable_to_non_nullable
as String,tree: null == tree ? _self.tree : tree // ignore: cast_nullable_to_non_nullable
as List<CatalogNode>,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogTree].
extension CatalogTreePatterns on CatalogTree {
/// A variant of `map` that fallback to returning `orElse`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogTree value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogTree() when $default != null:
return $default(_that);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// Callbacks receives the raw object, upcasted.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case final Subclass2 value:
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogTree value)  $default,){
final _that = this;
switch (_that) {
case _CatalogTree():
return $default(_that);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `map` that fallback to returning `null`.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case final Subclass value:
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogTree value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogTree() when $default != null:
return $default(_that);case _:
  return null;

}
}
/// A variant of `when` that fallback to an `orElse` callback.
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return orElse();
/// }
/// ```

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String type,  List<CatalogNode> tree)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogTree() when $default != null:
return $default(_that.type,_that.tree);case _:
  return orElse();

}
}
/// A `switch`-like method, using callbacks.
///
/// As opposed to `map`, this offers destructuring.
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case Subclass2(:final field2):
///     return ...;
/// }
/// ```

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String type,  List<CatalogNode> tree)  $default,) {final _that = this;
switch (_that) {
case _CatalogTree():
return $default(_that.type,_that.tree);case _:
  throw StateError('Unexpected subclass');

}
}
/// A variant of `when` that fallback to returning `null`
///
/// It is equivalent to doing:
/// ```dart
/// switch (sealedClass) {
///   case Subclass(:final field):
///     return ...;
///   case _:
///     return null;
/// }
/// ```

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String type,  List<CatalogNode> tree)?  $default,) {final _that = this;
switch (_that) {
case _CatalogTree() when $default != null:
return $default(_that.type,_that.tree);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogTree implements CatalogTree {
  const _CatalogTree({required this.type, required  List<CatalogNode> tree}): _tree = tree;
  factory _CatalogTree.fromJson(Map<String, dynamic> json) => _$CatalogTreeFromJson(json);

@override final  String type;
 final  List<CatalogNode> _tree;
@override List<CatalogNode> get tree {
  if (_tree is EqualUnmodifiableListView) return _tree;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_tree);
}


/// Create a copy of CatalogTree
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogTreeCopyWith<_CatalogTree> get copyWith => __$CatalogTreeCopyWithImpl<_CatalogTree>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogTreeToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogTree&&(identical(other.type, type) || other.type == type)&&const DeepCollectionEquality().equals(other.tree, _tree));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,type,const DeepCollectionEquality().hash(_tree));
}

@override
String toString() {
    return 'CatalogTree(type: $type, tree: $tree)';
}


}

/// @nodoc
abstract mixin class _$CatalogTreeCopyWith<$Res> implements $CatalogTreeCopyWith<$Res> {
  factory _$CatalogTreeCopyWith(_CatalogTree value, $Res Function(_CatalogTree) _then) = __$CatalogTreeCopyWithImpl;
@override @useResult
$Res call({
 String type, List<CatalogNode> tree
});




}
/// @nodoc
class __$CatalogTreeCopyWithImpl<$Res>
    implements _$CatalogTreeCopyWith<$Res> {
  __$CatalogTreeCopyWithImpl(this._self, this._then);

  final _CatalogTree _self;
  final $Res Function(_CatalogTree) _then;

/// Create a copy of CatalogTree
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? type = null,Object? tree = null,}) {
  return _then(_CatalogTree(
type: null == type ? _self.type : type // ignore: cast_nullable_to_non_nullable
as String,tree: null == tree ? _self._tree : tree // ignore: cast_nullable_to_non_nullable
as List<CatalogNode>,
  ));
}


}

// dart format on
