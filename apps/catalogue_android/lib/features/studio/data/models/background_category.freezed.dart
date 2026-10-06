// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'background_category.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$BackgroundCategory {

 int get id; String get slug; String get label; String? get thumbnailUrl;
/// Create a copy of BackgroundCategory
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$BackgroundCategoryCopyWith<BackgroundCategory> get copyWith => _$BackgroundCategoryCopyWithImpl<BackgroundCategory>(this as BackgroundCategory, _$identity);

  /// Serializes this BackgroundCategory to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as BackgroundCategory;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is BackgroundCategory&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.slug, _this.slug) || other.slug == _this.slug)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as BackgroundCategory;
  return Object.hash(runtimeType,_this.id,_this.slug,_this.label,_this.thumbnailUrl);
}

@override
String toString() {
  final _this = this as BackgroundCategory;
  return 'BackgroundCategory(id: ${_this.id}, slug: ${_this.slug}, label: ${_this.label}, thumbnailUrl: ${_this.thumbnailUrl})';
}


}

/// @nodoc
abstract mixin class $BackgroundCategoryCopyWith<$Res>  {
  factory $BackgroundCategoryCopyWith(BackgroundCategory value, $Res Function(BackgroundCategory) _then) = _$BackgroundCategoryCopyWithImpl;
@useResult
$Res call({
 int id, String slug, String label, String? thumbnailUrl
});




}
/// @nodoc
class _$BackgroundCategoryCopyWithImpl<$Res>
    implements $BackgroundCategoryCopyWith<$Res> {
  _$BackgroundCategoryCopyWithImpl(this._self, this._then);

  final BackgroundCategory _self;
  final $Res Function(BackgroundCategory) _then;

/// Create a copy of BackgroundCategory
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? slug = null,Object? label = null,Object? thumbnailUrl = freezed,}) {
  return _then(BackgroundCategory(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [BackgroundCategory].
extension BackgroundCategoryPatterns on BackgroundCategory {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _BackgroundCategory value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _BackgroundCategory() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _BackgroundCategory value)  $default,){
final _that = this;
switch (_that) {
case _BackgroundCategory():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _BackgroundCategory value)?  $default,){
final _that = this;
switch (_that) {
case _BackgroundCategory() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( int id,  String slug,  String label,  String? thumbnailUrl)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _BackgroundCategory() when $default != null:
return $default(_that.id,_that.slug,_that.label,_that.thumbnailUrl);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( int id,  String slug,  String label,  String? thumbnailUrl)  $default,) {final _that = this;
switch (_that) {
case _BackgroundCategory():
return $default(_that.id,_that.slug,_that.label,_that.thumbnailUrl);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( int id,  String slug,  String label,  String? thumbnailUrl)?  $default,) {final _that = this;
switch (_that) {
case _BackgroundCategory() when $default != null:
return $default(_that.id,_that.slug,_that.label,_that.thumbnailUrl);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _BackgroundCategory implements BackgroundCategory {
  const _BackgroundCategory({required this.id, required this.slug, required this.label, this.thumbnailUrl});
  factory _BackgroundCategory.fromJson(Map<String, dynamic> json) => _$BackgroundCategoryFromJson(json);

@override final  int id;
@override final  String slug;
@override final  String label;
@override final  String? thumbnailUrl;

/// Create a copy of BackgroundCategory
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$BackgroundCategoryCopyWith<_BackgroundCategory> get copyWith => __$BackgroundCategoryCopyWithImpl<_BackgroundCategory>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$BackgroundCategoryToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _BackgroundCategory&&(identical(other.id, id) || other.id == id)&&(identical(other.slug, slug) || other.slug == slug)&&(identical(other.label, label) || other.label == label)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,slug,label,thumbnailUrl);
}

@override
String toString() {
    return 'BackgroundCategory(id: $id, slug: $slug, label: $label, thumbnailUrl: $thumbnailUrl)';
}


}

/// @nodoc
abstract mixin class _$BackgroundCategoryCopyWith<$Res> implements $BackgroundCategoryCopyWith<$Res> {
  factory _$BackgroundCategoryCopyWith(_BackgroundCategory value, $Res Function(_BackgroundCategory) _then) = __$BackgroundCategoryCopyWithImpl;
@override @useResult
$Res call({
 int id, String slug, String label, String? thumbnailUrl
});




}
/// @nodoc
class __$BackgroundCategoryCopyWithImpl<$Res>
    implements _$BackgroundCategoryCopyWith<$Res> {
  __$BackgroundCategoryCopyWithImpl(this._self, this._then);

  final _BackgroundCategory _self;
  final $Res Function(_BackgroundCategory) _then;

/// Create a copy of BackgroundCategory
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? slug = null,Object? label = null,Object? thumbnailUrl = freezed,}) {
  return _then(_BackgroundCategory(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as int,slug: null == slug ? _self.slug : slug // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
