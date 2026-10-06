// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'uploaded_asset.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$UploadedAsset {

 String get r2Key; String get uploadedAt; int get jobsCount; String? get thumbnailUrl;
/// Create a copy of UploadedAsset
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$UploadedAssetCopyWith<UploadedAsset> get copyWith => _$UploadedAssetCopyWithImpl<UploadedAsset>(this as UploadedAsset, _$identity);

  /// Serializes this UploadedAsset to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as UploadedAsset;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is UploadedAsset&&(identical(other.r2Key, _this.r2Key) || other.r2Key == _this.r2Key)&&(identical(other.uploadedAt, _this.uploadedAt) || other.uploadedAt == _this.uploadedAt)&&(identical(other.jobsCount, _this.jobsCount) || other.jobsCount == _this.jobsCount)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as UploadedAsset;
  return Object.hash(runtimeType,_this.r2Key,_this.uploadedAt,_this.jobsCount,_this.thumbnailUrl);
}

@override
String toString() {
  final _this = this as UploadedAsset;
  return 'UploadedAsset(r2Key: ${_this.r2Key}, uploadedAt: ${_this.uploadedAt}, jobsCount: ${_this.jobsCount}, thumbnailUrl: ${_this.thumbnailUrl})';
}


}

/// @nodoc
abstract mixin class $UploadedAssetCopyWith<$Res>  {
  factory $UploadedAssetCopyWith(UploadedAsset value, $Res Function(UploadedAsset) _then) = _$UploadedAssetCopyWithImpl;
@useResult
$Res call({
 String r2Key, String uploadedAt, int jobsCount, String? thumbnailUrl
});




}
/// @nodoc
class _$UploadedAssetCopyWithImpl<$Res>
    implements $UploadedAssetCopyWith<$Res> {
  _$UploadedAssetCopyWithImpl(this._self, this._then);

  final UploadedAsset _self;
  final $Res Function(UploadedAsset) _then;

/// Create a copy of UploadedAsset
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? r2Key = null,Object? uploadedAt = null,Object? jobsCount = null,Object? thumbnailUrl = freezed,}) {
  return _then(UploadedAsset(
r2Key: null == r2Key ? _self.r2Key : r2Key // ignore: cast_nullable_to_non_nullable
as String,uploadedAt: null == uploadedAt ? _self.uploadedAt : uploadedAt // ignore: cast_nullable_to_non_nullable
as String,jobsCount: null == jobsCount ? _self.jobsCount : jobsCount // ignore: cast_nullable_to_non_nullable
as int,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [UploadedAsset].
extension UploadedAssetPatterns on UploadedAsset {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _UploadedAsset value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _UploadedAsset() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _UploadedAsset value)  $default,){
final _that = this;
switch (_that) {
case _UploadedAsset():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _UploadedAsset value)?  $default,){
final _that = this;
switch (_that) {
case _UploadedAsset() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String r2Key,  String uploadedAt,  int jobsCount,  String? thumbnailUrl)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _UploadedAsset() when $default != null:
return $default(_that.r2Key,_that.uploadedAt,_that.jobsCount,_that.thumbnailUrl);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String r2Key,  String uploadedAt,  int jobsCount,  String? thumbnailUrl)  $default,) {final _that = this;
switch (_that) {
case _UploadedAsset():
return $default(_that.r2Key,_that.uploadedAt,_that.jobsCount,_that.thumbnailUrl);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String r2Key,  String uploadedAt,  int jobsCount,  String? thumbnailUrl)?  $default,) {final _that = this;
switch (_that) {
case _UploadedAsset() when $default != null:
return $default(_that.r2Key,_that.uploadedAt,_that.jobsCount,_that.thumbnailUrl);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _UploadedAsset implements UploadedAsset {
  const _UploadedAsset({required this.r2Key, required this.uploadedAt, required this.jobsCount, this.thumbnailUrl});
  factory _UploadedAsset.fromJson(Map<String, dynamic> json) => _$UploadedAssetFromJson(json);

@override final  String r2Key;
@override final  String uploadedAt;
@override final  int jobsCount;
@override final  String? thumbnailUrl;

/// Create a copy of UploadedAsset
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$UploadedAssetCopyWith<_UploadedAsset> get copyWith => __$UploadedAssetCopyWithImpl<_UploadedAsset>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$UploadedAssetToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _UploadedAsset&&(identical(other.r2Key, r2Key) || other.r2Key == r2Key)&&(identical(other.uploadedAt, uploadedAt) || other.uploadedAt == uploadedAt)&&(identical(other.jobsCount, jobsCount) || other.jobsCount == jobsCount)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,r2Key,uploadedAt,jobsCount,thumbnailUrl);
}

@override
String toString() {
    return 'UploadedAsset(r2Key: $r2Key, uploadedAt: $uploadedAt, jobsCount: $jobsCount, thumbnailUrl: $thumbnailUrl)';
}


}

/// @nodoc
abstract mixin class _$UploadedAssetCopyWith<$Res> implements $UploadedAssetCopyWith<$Res> {
  factory _$UploadedAssetCopyWith(_UploadedAsset value, $Res Function(_UploadedAsset) _then) = __$UploadedAssetCopyWithImpl;
@override @useResult
$Res call({
 String r2Key, String uploadedAt, int jobsCount, String? thumbnailUrl
});




}
/// @nodoc
class __$UploadedAssetCopyWithImpl<$Res>
    implements _$UploadedAssetCopyWith<$Res> {
  __$UploadedAssetCopyWithImpl(this._self, this._then);

  final _UploadedAsset _self;
  final $Res Function(_UploadedAsset) _then;

/// Create a copy of UploadedAsset
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? r2Key = null,Object? uploadedAt = null,Object? jobsCount = null,Object? thumbnailUrl = freezed,}) {
  return _then(_UploadedAsset(
r2Key: null == r2Key ? _self.r2Key : r2Key // ignore: cast_nullable_to_non_nullable
as String,uploadedAt: null == uploadedAt ? _self.uploadedAt : uploadedAt // ignore: cast_nullable_to_non_nullable
as String,jobsCount: null == jobsCount ? _self.jobsCount : jobsCount // ignore: cast_nullable_to_non_nullable
as int,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
