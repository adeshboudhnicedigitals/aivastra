// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'catalog_video_row.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$CatalogVideoRow {

 String get id; String get status; String get createdAt; String? get sampleVideoId; String? get videoUrl; String? get thumbnailUrl; int? get duration;
/// Create a copy of CatalogVideoRow
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogVideoRowCopyWith<CatalogVideoRow> get copyWith => _$CatalogVideoRowCopyWithImpl<CatalogVideoRow>(this as CatalogVideoRow, _$identity);

  /// Serializes this CatalogVideoRow to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogVideoRow;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogVideoRow&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.status, _this.status) || other.status == _this.status)&&(identical(other.createdAt, _this.createdAt) || other.createdAt == _this.createdAt)&&(identical(other.sampleVideoId, _this.sampleVideoId) || other.sampleVideoId == _this.sampleVideoId)&&(identical(other.videoUrl, _this.videoUrl) || other.videoUrl == _this.videoUrl)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl)&&(identical(other.duration, _this.duration) || other.duration == _this.duration));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogVideoRow;
  return Object.hash(runtimeType,_this.id,_this.status,_this.createdAt,_this.sampleVideoId,_this.videoUrl,_this.thumbnailUrl,_this.duration);
}

@override
String toString() {
  final _this = this as CatalogVideoRow;
  return 'CatalogVideoRow(id: ${_this.id}, status: ${_this.status}, createdAt: ${_this.createdAt}, sampleVideoId: ${_this.sampleVideoId}, videoUrl: ${_this.videoUrl}, thumbnailUrl: ${_this.thumbnailUrl}, duration: ${_this.duration})';
}


}

/// @nodoc
abstract mixin class $CatalogVideoRowCopyWith<$Res>  {
  factory $CatalogVideoRowCopyWith(CatalogVideoRow value, $Res Function(CatalogVideoRow) _then) = _$CatalogVideoRowCopyWithImpl;
@useResult
$Res call({
 String id, String status, String createdAt, String? sampleVideoId, String? videoUrl, String? thumbnailUrl, int? duration
});




}
/// @nodoc
class _$CatalogVideoRowCopyWithImpl<$Res>
    implements $CatalogVideoRowCopyWith<$Res> {
  _$CatalogVideoRowCopyWithImpl(this._self, this._then);

  final CatalogVideoRow _self;
  final $Res Function(CatalogVideoRow) _then;

/// Create a copy of CatalogVideoRow
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? status = null,Object? createdAt = null,Object? sampleVideoId = freezed,Object? videoUrl = freezed,Object? thumbnailUrl = freezed,Object? duration = freezed,}) {
  return _then(CatalogVideoRow(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,sampleVideoId: freezed == sampleVideoId ? _self.sampleVideoId : sampleVideoId // ignore: cast_nullable_to_non_nullable
as String?,videoUrl: freezed == videoUrl ? _self.videoUrl : videoUrl // ignore: cast_nullable_to_non_nullable
as String?,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,duration: freezed == duration ? _self.duration : duration // ignore: cast_nullable_to_non_nullable
as int?,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogVideoRow].
extension CatalogVideoRowPatterns on CatalogVideoRow {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogVideoRow value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogVideoRow() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogVideoRow value)  $default,){
final _that = this;
switch (_that) {
case _CatalogVideoRow():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogVideoRow value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogVideoRow() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String status,  String createdAt,  String? sampleVideoId,  String? videoUrl,  String? thumbnailUrl,  int? duration)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogVideoRow() when $default != null:
return $default(_that.id,_that.status,_that.createdAt,_that.sampleVideoId,_that.videoUrl,_that.thumbnailUrl,_that.duration);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String status,  String createdAt,  String? sampleVideoId,  String? videoUrl,  String? thumbnailUrl,  int? duration)  $default,) {final _that = this;
switch (_that) {
case _CatalogVideoRow():
return $default(_that.id,_that.status,_that.createdAt,_that.sampleVideoId,_that.videoUrl,_that.thumbnailUrl,_that.duration);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String status,  String createdAt,  String? sampleVideoId,  String? videoUrl,  String? thumbnailUrl,  int? duration)?  $default,) {final _that = this;
switch (_that) {
case _CatalogVideoRow() when $default != null:
return $default(_that.id,_that.status,_that.createdAt,_that.sampleVideoId,_that.videoUrl,_that.thumbnailUrl,_that.duration);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogVideoRow extends CatalogVideoRow {
  const _CatalogVideoRow({required this.id, required this.status, required this.createdAt, this.sampleVideoId, this.videoUrl, this.thumbnailUrl, this.duration}): super._();
  factory _CatalogVideoRow.fromJson(Map<String, dynamic> json) => _$CatalogVideoRowFromJson(json);

@override final  String id;
@override final  String status;
@override final  String createdAt;
@override final  String? sampleVideoId;
@override final  String? videoUrl;
@override final  String? thumbnailUrl;
@override final  int? duration;

/// Create a copy of CatalogVideoRow
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogVideoRowCopyWith<_CatalogVideoRow> get copyWith => __$CatalogVideoRowCopyWithImpl<_CatalogVideoRow>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogVideoRowToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogVideoRow&&(identical(other.id, id) || other.id == id)&&(identical(other.status, status) || other.status == status)&&(identical(other.createdAt, createdAt) || other.createdAt == createdAt)&&(identical(other.sampleVideoId, sampleVideoId) || other.sampleVideoId == sampleVideoId)&&(identical(other.videoUrl, videoUrl) || other.videoUrl == videoUrl)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl)&&(identical(other.duration, duration) || other.duration == duration));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,status,createdAt,sampleVideoId,videoUrl,thumbnailUrl,duration);
}

@override
String toString() {
    return 'CatalogVideoRow(id: $id, status: $status, createdAt: $createdAt, sampleVideoId: $sampleVideoId, videoUrl: $videoUrl, thumbnailUrl: $thumbnailUrl, duration: $duration)';
}


}

/// @nodoc
abstract mixin class _$CatalogVideoRowCopyWith<$Res> implements $CatalogVideoRowCopyWith<$Res> {
  factory _$CatalogVideoRowCopyWith(_CatalogVideoRow value, $Res Function(_CatalogVideoRow) _then) = __$CatalogVideoRowCopyWithImpl;
@override @useResult
$Res call({
 String id, String status, String createdAt, String? sampleVideoId, String? videoUrl, String? thumbnailUrl, int? duration
});




}
/// @nodoc
class __$CatalogVideoRowCopyWithImpl<$Res>
    implements _$CatalogVideoRowCopyWith<$Res> {
  __$CatalogVideoRowCopyWithImpl(this._self, this._then);

  final _CatalogVideoRow _self;
  final $Res Function(_CatalogVideoRow) _then;

/// Create a copy of CatalogVideoRow
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? status = null,Object? createdAt = null,Object? sampleVideoId = freezed,Object? videoUrl = freezed,Object? thumbnailUrl = freezed,Object? duration = freezed,}) {
  return _then(_CatalogVideoRow(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,status: null == status ? _self.status : status // ignore: cast_nullable_to_non_nullable
as String,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,sampleVideoId: freezed == sampleVideoId ? _self.sampleVideoId : sampleVideoId // ignore: cast_nullable_to_non_nullable
as String?,videoUrl: freezed == videoUrl ? _self.videoUrl : videoUrl // ignore: cast_nullable_to_non_nullable
as String?,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,duration: freezed == duration ? _self.duration : duration // ignore: cast_nullable_to_non_nullable
as int?,
  ));
}


}

// dart format on
