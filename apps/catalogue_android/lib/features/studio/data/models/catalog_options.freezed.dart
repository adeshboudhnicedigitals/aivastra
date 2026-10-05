// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'catalog_options.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$CatalogOptionItem {

 String get slug; String get label; String? get thumbnailUrl;
/// Create a copy of CatalogOptionItem
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogOptionItemCopyWith<CatalogOptionItem> get copyWith => _$CatalogOptionItemCopyWithImpl<CatalogOptionItem>(this as CatalogOptionItem, _$identity);

  /// Serializes this CatalogOptionItem to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogOptionItem;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogOptionItem&&(identical(other.slug, _this.slug) || other.slug == _this.slug)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogOptionItem;
  return Object.hash(runtimeType,_this.slug,_this.label,_this.thumbnailUrl);
}

@override
String toString() {
  final _this = this as CatalogOptionItem;
  return 'CatalogOptionItem(slug: ${_this.slug}, label: ${_this.label}, thumbnailUrl: ${_this.thumbnailUrl})';
}


}

/// @nodoc
abstract mixin class $CatalogOptionItemCopyWith<$Res>  {
  factory $CatalogOptionItemCopyWith(CatalogOptionItem value, $Res Function(CatalogOptionItem) _then) = _$CatalogOptionItemCopyWithImpl;
@useResult
$Res call({
 String slug, String label, String? thumbnailUrl
});




}
/// @nodoc
class _$CatalogOptionItemCopyWithImpl<$Res>
    implements $CatalogOptionItemCopyWith<$Res> {
  _$CatalogOptionItemCopyWithImpl(this._self, this._then);

  final CatalogOptionItem _self;
  final $Res Function(CatalogOptionItem) _then;

/// Create a copy of CatalogOptionItem
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? slug = null,Object? label = null,Object? thumbnailUrl = freezed,}) {
  return _then(CatalogOptionItem(
slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogOptionItem].
extension CatalogOptionItemPatterns on CatalogOptionItem {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogOptionItem value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogOptionItem() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogOptionItem value)  $default,){
final _that = this;
switch (_that) {
case _CatalogOptionItem():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogOptionItem value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogOptionItem() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String slug,  String label,  String? thumbnailUrl)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogOptionItem() when $default != null:
return $default(_that.slug,_that.label,_that.thumbnailUrl);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String slug,  String label,  String? thumbnailUrl)  $default,) {final _that = this;
switch (_that) {
case _CatalogOptionItem():
return $default(_that.slug,_that.label,_that.thumbnailUrl);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String slug,  String label,  String? thumbnailUrl)?  $default,) {final _that = this;
switch (_that) {
case _CatalogOptionItem() when $default != null:
return $default(_that.slug,_that.label,_that.thumbnailUrl);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogOptionItem implements CatalogOptionItem {
  const _CatalogOptionItem({required this.slug, required this.label, this.thumbnailUrl});
  factory _CatalogOptionItem.fromJson(Map<String, dynamic> json) => _$CatalogOptionItemFromJson(json);

@override final  String slug;
@override final  String label;
@override final  String? thumbnailUrl;

/// Create a copy of CatalogOptionItem
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogOptionItemCopyWith<_CatalogOptionItem> get copyWith => __$CatalogOptionItemCopyWithImpl<_CatalogOptionItem>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogOptionItemToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogOptionItem&&(identical(other.slug, slug) || other.slug == slug)&&(identical(other.label, label) || other.label == label)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,slug,label,thumbnailUrl);
}

@override
String toString() {
    return 'CatalogOptionItem(slug: $slug, label: $label, thumbnailUrl: $thumbnailUrl)';
}


}

/// @nodoc
abstract mixin class _$CatalogOptionItemCopyWith<$Res> implements $CatalogOptionItemCopyWith<$Res> {
  factory _$CatalogOptionItemCopyWith(_CatalogOptionItem value, $Res Function(_CatalogOptionItem) _then) = __$CatalogOptionItemCopyWithImpl;
@override @useResult
$Res call({
 String slug, String label, String? thumbnailUrl
});




}
/// @nodoc
class __$CatalogOptionItemCopyWithImpl<$Res>
    implements _$CatalogOptionItemCopyWith<$Res> {
  __$CatalogOptionItemCopyWithImpl(this._self, this._then);

  final _CatalogOptionItem _self;
  final $Res Function(_CatalogOptionItem) _then;

/// Create a copy of CatalogOptionItem
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? slug = null,Object? label = null,Object? thumbnailUrl = freezed,}) {
  return _then(_CatalogOptionItem(
slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}


/// @nodoc
mixin _$CatalogOptionGarmentType {

 String get slug; String get label; bool get requiresLowerUpload; String? get lowerUploadLabel; bool get requiresThirdUpload; String? get thirdUploadLabel;
/// Create a copy of CatalogOptionGarmentType
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogOptionGarmentTypeCopyWith<CatalogOptionGarmentType> get copyWith => _$CatalogOptionGarmentTypeCopyWithImpl<CatalogOptionGarmentType>(this as CatalogOptionGarmentType, _$identity);

  /// Serializes this CatalogOptionGarmentType to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogOptionGarmentType;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogOptionGarmentType&&(identical(other.slug, _this.slug) || other.slug == _this.slug)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.requiresLowerUpload, _this.requiresLowerUpload) || other.requiresLowerUpload == _this.requiresLowerUpload)&&(identical(other.lowerUploadLabel, _this.lowerUploadLabel) || other.lowerUploadLabel == _this.lowerUploadLabel)&&(identical(other.requiresThirdUpload, _this.requiresThirdUpload) || other.requiresThirdUpload == _this.requiresThirdUpload)&&(identical(other.thirdUploadLabel, _this.thirdUploadLabel) || other.thirdUploadLabel == _this.thirdUploadLabel));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogOptionGarmentType;
  return Object.hash(runtimeType,_this.slug,_this.label,_this.requiresLowerUpload,_this.lowerUploadLabel,_this.requiresThirdUpload,_this.thirdUploadLabel);
}

@override
String toString() {
  final _this = this as CatalogOptionGarmentType;
  return 'CatalogOptionGarmentType(slug: ${_this.slug}, label: ${_this.label}, requiresLowerUpload: ${_this.requiresLowerUpload}, lowerUploadLabel: ${_this.lowerUploadLabel}, requiresThirdUpload: ${_this.requiresThirdUpload}, thirdUploadLabel: ${_this.thirdUploadLabel})';
}


}

/// @nodoc
abstract mixin class $CatalogOptionGarmentTypeCopyWith<$Res>  {
  factory $CatalogOptionGarmentTypeCopyWith(CatalogOptionGarmentType value, $Res Function(CatalogOptionGarmentType) _then) = _$CatalogOptionGarmentTypeCopyWithImpl;
@useResult
$Res call({
 String slug, String label, bool requiresLowerUpload, String? lowerUploadLabel, bool requiresThirdUpload, String? thirdUploadLabel
});




}
/// @nodoc
class _$CatalogOptionGarmentTypeCopyWithImpl<$Res>
    implements $CatalogOptionGarmentTypeCopyWith<$Res> {
  _$CatalogOptionGarmentTypeCopyWithImpl(this._self, this._then);

  final CatalogOptionGarmentType _self;
  final $Res Function(CatalogOptionGarmentType) _then;

/// Create a copy of CatalogOptionGarmentType
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? slug = null,Object? label = null,Object? requiresLowerUpload = null,Object? lowerUploadLabel = freezed,Object? requiresThirdUpload = null,Object? thirdUploadLabel = freezed,}) {
  return _then(CatalogOptionGarmentType(
slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,requiresLowerUpload: null == requiresLowerUpload ? _self.requiresLowerUpload : requiresLowerUpload // ignore: cast_nullable_to_non_nullable
as bool,lowerUploadLabel: freezed == lowerUploadLabel ? _self.lowerUploadLabel : lowerUploadLabel // ignore: cast_nullable_to_non_nullable
as String?,requiresThirdUpload: null == requiresThirdUpload ? _self.requiresThirdUpload : requiresThirdUpload // ignore: cast_nullable_to_non_nullable
as bool,thirdUploadLabel: freezed == thirdUploadLabel ? _self.thirdUploadLabel : thirdUploadLabel // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogOptionGarmentType].
extension CatalogOptionGarmentTypePatterns on CatalogOptionGarmentType {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogOptionGarmentType value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogOptionGarmentType() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogOptionGarmentType value)  $default,){
final _that = this;
switch (_that) {
case _CatalogOptionGarmentType():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogOptionGarmentType value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogOptionGarmentType() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String slug,  String label,  bool requiresLowerUpload,  String? lowerUploadLabel,  bool requiresThirdUpload,  String? thirdUploadLabel)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogOptionGarmentType() when $default != null:
return $default(_that.slug,_that.label,_that.requiresLowerUpload,_that.lowerUploadLabel,_that.requiresThirdUpload,_that.thirdUploadLabel);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String slug,  String label,  bool requiresLowerUpload,  String? lowerUploadLabel,  bool requiresThirdUpload,  String? thirdUploadLabel)  $default,) {final _that = this;
switch (_that) {
case _CatalogOptionGarmentType():
return $default(_that.slug,_that.label,_that.requiresLowerUpload,_that.lowerUploadLabel,_that.requiresThirdUpload,_that.thirdUploadLabel);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String slug,  String label,  bool requiresLowerUpload,  String? lowerUploadLabel,  bool requiresThirdUpload,  String? thirdUploadLabel)?  $default,) {final _that = this;
switch (_that) {
case _CatalogOptionGarmentType() when $default != null:
return $default(_that.slug,_that.label,_that.requiresLowerUpload,_that.lowerUploadLabel,_that.requiresThirdUpload,_that.thirdUploadLabel);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogOptionGarmentType implements CatalogOptionGarmentType {
  const _CatalogOptionGarmentType({required this.slug, required this.label, this.requiresLowerUpload = false, this.lowerUploadLabel, this.requiresThirdUpload = false, this.thirdUploadLabel});
  factory _CatalogOptionGarmentType.fromJson(Map<String, dynamic> json) => _$CatalogOptionGarmentTypeFromJson(json);

@override final  String slug;
@override final  String label;
@override@JsonKey() final  bool requiresLowerUpload;
@override final  String? lowerUploadLabel;
@override@JsonKey() final  bool requiresThirdUpload;
@override final  String? thirdUploadLabel;

/// Create a copy of CatalogOptionGarmentType
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogOptionGarmentTypeCopyWith<_CatalogOptionGarmentType> get copyWith => __$CatalogOptionGarmentTypeCopyWithImpl<_CatalogOptionGarmentType>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogOptionGarmentTypeToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogOptionGarmentType&&(identical(other.slug, slug) || other.slug == slug)&&(identical(other.label, label) || other.label == label)&&(identical(other.requiresLowerUpload, requiresLowerUpload) || other.requiresLowerUpload == requiresLowerUpload)&&(identical(other.lowerUploadLabel, lowerUploadLabel) || other.lowerUploadLabel == lowerUploadLabel)&&(identical(other.requiresThirdUpload, requiresThirdUpload) || other.requiresThirdUpload == requiresThirdUpload)&&(identical(other.thirdUploadLabel, thirdUploadLabel) || other.thirdUploadLabel == thirdUploadLabel));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,slug,label,requiresLowerUpload,lowerUploadLabel,requiresThirdUpload,thirdUploadLabel);
}

@override
String toString() {
    return 'CatalogOptionGarmentType(slug: $slug, label: $label, requiresLowerUpload: $requiresLowerUpload, lowerUploadLabel: $lowerUploadLabel, requiresThirdUpload: $requiresThirdUpload, thirdUploadLabel: $thirdUploadLabel)';
}


}

/// @nodoc
abstract mixin class _$CatalogOptionGarmentTypeCopyWith<$Res> implements $CatalogOptionGarmentTypeCopyWith<$Res> {
  factory _$CatalogOptionGarmentTypeCopyWith(_CatalogOptionGarmentType value, $Res Function(_CatalogOptionGarmentType) _then) = __$CatalogOptionGarmentTypeCopyWithImpl;
@override @useResult
$Res call({
 String slug, String label, bool requiresLowerUpload, String? lowerUploadLabel, bool requiresThirdUpload, String? thirdUploadLabel
});




}
/// @nodoc
class __$CatalogOptionGarmentTypeCopyWithImpl<$Res>
    implements _$CatalogOptionGarmentTypeCopyWith<$Res> {
  __$CatalogOptionGarmentTypeCopyWithImpl(this._self, this._then);

  final _CatalogOptionGarmentType _self;
  final $Res Function(_CatalogOptionGarmentType) _then;

/// Create a copy of CatalogOptionGarmentType
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? slug = null,Object? label = null,Object? requiresLowerUpload = null,Object? lowerUploadLabel = freezed,Object? requiresThirdUpload = null,Object? thirdUploadLabel = freezed,}) {
  return _then(_CatalogOptionGarmentType(
slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,requiresLowerUpload: null == requiresLowerUpload ? _self.requiresLowerUpload : requiresLowerUpload // ignore: cast_nullable_to_non_nullable
as bool,lowerUploadLabel: freezed == lowerUploadLabel ? _self.lowerUploadLabel : lowerUploadLabel // ignore: cast_nullable_to_non_nullable
as String?,requiresThirdUpload: null == requiresThirdUpload ? _self.requiresThirdUpload : requiresThirdUpload // ignore: cast_nullable_to_non_nullable
as bool,thirdUploadLabel: freezed == thirdUploadLabel ? _self.thirdUploadLabel : thirdUploadLabel // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}


/// @nodoc
mixin _$CatalogOptionPose {

 String get slug; String get label; String get thumbnailUrl; bool get hasLower; bool get hasShoes;
/// Create a copy of CatalogOptionPose
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogOptionPoseCopyWith<CatalogOptionPose> get copyWith => _$CatalogOptionPoseCopyWithImpl<CatalogOptionPose>(this as CatalogOptionPose, _$identity);

  /// Serializes this CatalogOptionPose to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogOptionPose;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogOptionPose&&(identical(other.slug, _this.slug) || other.slug == _this.slug)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl)&&(identical(other.hasLower, _this.hasLower) || other.hasLower == _this.hasLower)&&(identical(other.hasShoes, _this.hasShoes) || other.hasShoes == _this.hasShoes));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogOptionPose;
  return Object.hash(runtimeType,_this.slug,_this.label,_this.thumbnailUrl,_this.hasLower,_this.hasShoes);
}

@override
String toString() {
  final _this = this as CatalogOptionPose;
  return 'CatalogOptionPose(slug: ${_this.slug}, label: ${_this.label}, thumbnailUrl: ${_this.thumbnailUrl}, hasLower: ${_this.hasLower}, hasShoes: ${_this.hasShoes})';
}


}

/// @nodoc
abstract mixin class $CatalogOptionPoseCopyWith<$Res>  {
  factory $CatalogOptionPoseCopyWith(CatalogOptionPose value, $Res Function(CatalogOptionPose) _then) = _$CatalogOptionPoseCopyWithImpl;
@useResult
$Res call({
 String slug, String label, String thumbnailUrl, bool hasLower, bool hasShoes
});




}
/// @nodoc
class _$CatalogOptionPoseCopyWithImpl<$Res>
    implements $CatalogOptionPoseCopyWith<$Res> {
  _$CatalogOptionPoseCopyWithImpl(this._self, this._then);

  final CatalogOptionPose _self;
  final $Res Function(CatalogOptionPose) _then;

/// Create a copy of CatalogOptionPose
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? slug = null,Object? label = null,Object? thumbnailUrl = null,Object? hasLower = null,Object? hasShoes = null,}) {
  return _then(CatalogOptionPose(
slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,hasLower: null == hasLower ? _self.hasLower : hasLower // ignore: cast_nullable_to_non_nullable
as bool,hasShoes: null == hasShoes ? _self.hasShoes : hasShoes // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogOptionPose].
extension CatalogOptionPosePatterns on CatalogOptionPose {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogOptionPose value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogOptionPose() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogOptionPose value)  $default,){
final _that = this;
switch (_that) {
case _CatalogOptionPose():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogOptionPose value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogOptionPose() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String slug,  String label,  String thumbnailUrl,  bool hasLower,  bool hasShoes)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogOptionPose() when $default != null:
return $default(_that.slug,_that.label,_that.thumbnailUrl,_that.hasLower,_that.hasShoes);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String slug,  String label,  String thumbnailUrl,  bool hasLower,  bool hasShoes)  $default,) {final _that = this;
switch (_that) {
case _CatalogOptionPose():
return $default(_that.slug,_that.label,_that.thumbnailUrl,_that.hasLower,_that.hasShoes);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String slug,  String label,  String thumbnailUrl,  bool hasLower,  bool hasShoes)?  $default,) {final _that = this;
switch (_that) {
case _CatalogOptionPose() when $default != null:
return $default(_that.slug,_that.label,_that.thumbnailUrl,_that.hasLower,_that.hasShoes);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogOptionPose implements CatalogOptionPose {
  const _CatalogOptionPose({required this.slug, required this.label, required this.thumbnailUrl, this.hasLower = false, this.hasShoes = false});
  factory _CatalogOptionPose.fromJson(Map<String, dynamic> json) => _$CatalogOptionPoseFromJson(json);

@override final  String slug;
@override final  String label;
@override final  String thumbnailUrl;
@override@JsonKey() final  bool hasLower;
@override@JsonKey() final  bool hasShoes;

/// Create a copy of CatalogOptionPose
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogOptionPoseCopyWith<_CatalogOptionPose> get copyWith => __$CatalogOptionPoseCopyWithImpl<_CatalogOptionPose>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogOptionPoseToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogOptionPose&&(identical(other.slug, slug) || other.slug == slug)&&(identical(other.label, label) || other.label == label)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl)&&(identical(other.hasLower, hasLower) || other.hasLower == hasLower)&&(identical(other.hasShoes, hasShoes) || other.hasShoes == hasShoes));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,slug,label,thumbnailUrl,hasLower,hasShoes);
}

@override
String toString() {
    return 'CatalogOptionPose(slug: $slug, label: $label, thumbnailUrl: $thumbnailUrl, hasLower: $hasLower, hasShoes: $hasShoes)';
}


}

/// @nodoc
abstract mixin class _$CatalogOptionPoseCopyWith<$Res> implements $CatalogOptionPoseCopyWith<$Res> {
  factory _$CatalogOptionPoseCopyWith(_CatalogOptionPose value, $Res Function(_CatalogOptionPose) _then) = __$CatalogOptionPoseCopyWithImpl;
@override @useResult
$Res call({
 String slug, String label, String thumbnailUrl, bool hasLower, bool hasShoes
});




}
/// @nodoc
class __$CatalogOptionPoseCopyWithImpl<$Res>
    implements _$CatalogOptionPoseCopyWith<$Res> {
  __$CatalogOptionPoseCopyWithImpl(this._self, this._then);

  final _CatalogOptionPose _self;
  final $Res Function(_CatalogOptionPose) _then;

/// Create a copy of CatalogOptionPose
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? slug = null,Object? label = null,Object? thumbnailUrl = null,Object? hasLower = null,Object? hasShoes = null,}) {
  return _then(_CatalogOptionPose(
slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,hasLower: null == hasLower ? _self.hasLower : hasLower // ignore: cast_nullable_to_non_nullable
as bool,hasShoes: null == hasShoes ? _self.hasShoes : hasShoes // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}


/// @nodoc
mixin _$CatalogOptions {

 List<CatalogOptionGarmentType> get garmentTypes; List<CatalogOptionItem> get faces; List<CatalogOptionItem> get backgrounds; List<CatalogOptionPose> get poses; List<CatalogOptionItem> get lowerItems; List<CatalogOptionItem> get shoeItems;
/// Create a copy of CatalogOptions
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogOptionsCopyWith<CatalogOptions> get copyWith => _$CatalogOptionsCopyWithImpl<CatalogOptions>(this as CatalogOptions, _$identity);

  /// Serializes this CatalogOptions to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogOptions;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogOptions&&const DeepCollectionEquality().equals(other.garmentTypes, _this.garmentTypes)&&const DeepCollectionEquality().equals(other.faces, _this.faces)&&const DeepCollectionEquality().equals(other.backgrounds, _this.backgrounds)&&const DeepCollectionEquality().equals(other.poses, _this.poses)&&const DeepCollectionEquality().equals(other.lowerItems, _this.lowerItems)&&const DeepCollectionEquality().equals(other.shoeItems, _this.shoeItems));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogOptions;
  return Object.hash(runtimeType,const DeepCollectionEquality().hash(_this.garmentTypes),const DeepCollectionEquality().hash(_this.faces),const DeepCollectionEquality().hash(_this.backgrounds),const DeepCollectionEquality().hash(_this.poses),const DeepCollectionEquality().hash(_this.lowerItems),const DeepCollectionEquality().hash(_this.shoeItems));
}

@override
String toString() {
  final _this = this as CatalogOptions;
  return 'CatalogOptions(garmentTypes: ${_this.garmentTypes}, faces: ${_this.faces}, backgrounds: ${_this.backgrounds}, poses: ${_this.poses}, lowerItems: ${_this.lowerItems}, shoeItems: ${_this.shoeItems})';
}


}

/// @nodoc
abstract mixin class $CatalogOptionsCopyWith<$Res>  {
  factory $CatalogOptionsCopyWith(CatalogOptions value, $Res Function(CatalogOptions) _then) = _$CatalogOptionsCopyWithImpl;
@useResult
$Res call({
 List<CatalogOptionGarmentType> garmentTypes, List<CatalogOptionItem> faces, List<CatalogOptionItem> backgrounds, List<CatalogOptionPose> poses, List<CatalogOptionItem> lowerItems, List<CatalogOptionItem> shoeItems
});




}
/// @nodoc
class _$CatalogOptionsCopyWithImpl<$Res>
    implements $CatalogOptionsCopyWith<$Res> {
  _$CatalogOptionsCopyWithImpl(this._self, this._then);

  final CatalogOptions _self;
  final $Res Function(CatalogOptions) _then;

/// Create a copy of CatalogOptions
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? garmentTypes = null,Object? faces = null,Object? backgrounds = null,Object? poses = null,Object? lowerItems = null,Object? shoeItems = null,}) {
  return _then(CatalogOptions(
garmentTypes: null == garmentTypes ? _self.garmentTypes : garmentTypes // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionGarmentType>,faces: null == faces ? _self.faces : faces // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionItem>,backgrounds: null == backgrounds ? _self.backgrounds : backgrounds // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionItem>,poses: null == poses ? _self.poses : poses // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionPose>,lowerItems: null == lowerItems ? _self.lowerItems : lowerItems // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionItem>,shoeItems: null == shoeItems ? _self.shoeItems : shoeItems // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionItem>,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogOptions].
extension CatalogOptionsPatterns on CatalogOptions {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogOptions value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogOptions() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogOptions value)  $default,){
final _that = this;
switch (_that) {
case _CatalogOptions():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogOptions value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogOptions() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( List<CatalogOptionGarmentType> garmentTypes,  List<CatalogOptionItem> faces,  List<CatalogOptionItem> backgrounds,  List<CatalogOptionPose> poses,  List<CatalogOptionItem> lowerItems,  List<CatalogOptionItem> shoeItems)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogOptions() when $default != null:
return $default(_that.garmentTypes,_that.faces,_that.backgrounds,_that.poses,_that.lowerItems,_that.shoeItems);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( List<CatalogOptionGarmentType> garmentTypes,  List<CatalogOptionItem> faces,  List<CatalogOptionItem> backgrounds,  List<CatalogOptionPose> poses,  List<CatalogOptionItem> lowerItems,  List<CatalogOptionItem> shoeItems)  $default,) {final _that = this;
switch (_that) {
case _CatalogOptions():
return $default(_that.garmentTypes,_that.faces,_that.backgrounds,_that.poses,_that.lowerItems,_that.shoeItems);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( List<CatalogOptionGarmentType> garmentTypes,  List<CatalogOptionItem> faces,  List<CatalogOptionItem> backgrounds,  List<CatalogOptionPose> poses,  List<CatalogOptionItem> lowerItems,  List<CatalogOptionItem> shoeItems)?  $default,) {final _that = this;
switch (_that) {
case _CatalogOptions() when $default != null:
return $default(_that.garmentTypes,_that.faces,_that.backgrounds,_that.poses,_that.lowerItems,_that.shoeItems);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogOptions implements CatalogOptions {
  const _CatalogOptions({ List<CatalogOptionGarmentType> garmentTypes = const [],  List<CatalogOptionItem> faces = const [],  List<CatalogOptionItem> backgrounds = const [],  List<CatalogOptionPose> poses = const [],  List<CatalogOptionItem> lowerItems = const [],  List<CatalogOptionItem> shoeItems = const []}): _garmentTypes = garmentTypes,_faces = faces,_backgrounds = backgrounds,_poses = poses,_lowerItems = lowerItems,_shoeItems = shoeItems;
  factory _CatalogOptions.fromJson(Map<String, dynamic> json) => _$CatalogOptionsFromJson(json);

 final  List<CatalogOptionGarmentType> _garmentTypes;
@override@JsonKey() List<CatalogOptionGarmentType> get garmentTypes {
  if (_garmentTypes is EqualUnmodifiableListView) return _garmentTypes;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_garmentTypes);
}

 final  List<CatalogOptionItem> _faces;
@override@JsonKey() List<CatalogOptionItem> get faces {
  if (_faces is EqualUnmodifiableListView) return _faces;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_faces);
}

 final  List<CatalogOptionItem> _backgrounds;
@override@JsonKey() List<CatalogOptionItem> get backgrounds {
  if (_backgrounds is EqualUnmodifiableListView) return _backgrounds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_backgrounds);
}

 final  List<CatalogOptionPose> _poses;
@override@JsonKey() List<CatalogOptionPose> get poses {
  if (_poses is EqualUnmodifiableListView) return _poses;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_poses);
}

 final  List<CatalogOptionItem> _lowerItems;
@override@JsonKey() List<CatalogOptionItem> get lowerItems {
  if (_lowerItems is EqualUnmodifiableListView) return _lowerItems;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_lowerItems);
}

 final  List<CatalogOptionItem> _shoeItems;
@override@JsonKey() List<CatalogOptionItem> get shoeItems {
  if (_shoeItems is EqualUnmodifiableListView) return _shoeItems;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_shoeItems);
}


/// Create a copy of CatalogOptions
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogOptionsCopyWith<_CatalogOptions> get copyWith => __$CatalogOptionsCopyWithImpl<_CatalogOptions>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogOptionsToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogOptions&&const DeepCollectionEquality().equals(other.garmentTypes, _garmentTypes)&&const DeepCollectionEquality().equals(other.faces, _faces)&&const DeepCollectionEquality().equals(other.backgrounds, _backgrounds)&&const DeepCollectionEquality().equals(other.poses, _poses)&&const DeepCollectionEquality().equals(other.lowerItems, _lowerItems)&&const DeepCollectionEquality().equals(other.shoeItems, _shoeItems));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_garmentTypes),const DeepCollectionEquality().hash(_faces),const DeepCollectionEquality().hash(_backgrounds),const DeepCollectionEquality().hash(_poses),const DeepCollectionEquality().hash(_lowerItems),const DeepCollectionEquality().hash(_shoeItems));
}

@override
String toString() {
    return 'CatalogOptions(garmentTypes: $garmentTypes, faces: $faces, backgrounds: $backgrounds, poses: $poses, lowerItems: $lowerItems, shoeItems: $shoeItems)';
}


}

/// @nodoc
abstract mixin class _$CatalogOptionsCopyWith<$Res> implements $CatalogOptionsCopyWith<$Res> {
  factory _$CatalogOptionsCopyWith(_CatalogOptions value, $Res Function(_CatalogOptions) _then) = __$CatalogOptionsCopyWithImpl;
@override @useResult
$Res call({
 List<CatalogOptionGarmentType> garmentTypes, List<CatalogOptionItem> faces, List<CatalogOptionItem> backgrounds, List<CatalogOptionPose> poses, List<CatalogOptionItem> lowerItems, List<CatalogOptionItem> shoeItems
});




}
/// @nodoc
class __$CatalogOptionsCopyWithImpl<$Res>
    implements _$CatalogOptionsCopyWith<$Res> {
  __$CatalogOptionsCopyWithImpl(this._self, this._then);

  final _CatalogOptions _self;
  final $Res Function(_CatalogOptions) _then;

/// Create a copy of CatalogOptions
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? garmentTypes = null,Object? faces = null,Object? backgrounds = null,Object? poses = null,Object? lowerItems = null,Object? shoeItems = null,}) {
  return _then(_CatalogOptions(
garmentTypes: null == garmentTypes ? _self._garmentTypes : garmentTypes // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionGarmentType>,faces: null == faces ? _self._faces : faces // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionItem>,backgrounds: null == backgrounds ? _self._backgrounds : backgrounds // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionItem>,poses: null == poses ? _self._poses : poses // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionPose>,lowerItems: null == lowerItems ? _self._lowerItems : lowerItems // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionItem>,shoeItems: null == shoeItems ? _self._shoeItems : shoeItems // ignore: cast_nullable_to_non_nullable
as List<CatalogOptionItem>,
  ));
}


}

// dart format on
