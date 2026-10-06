// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'upload_presign.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$UploadPresign {

 String get uploadUrl; String get r2Key; int get expiresIn;
/// Create a copy of UploadPresign
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$UploadPresignCopyWith<UploadPresign> get copyWith => _$UploadPresignCopyWithImpl<UploadPresign>(this as UploadPresign, _$identity);

  /// Serializes this UploadPresign to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as UploadPresign;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is UploadPresign&&(identical(other.uploadUrl, _this.uploadUrl) || other.uploadUrl == _this.uploadUrl)&&(identical(other.r2Key, _this.r2Key) || other.r2Key == _this.r2Key)&&(identical(other.expiresIn, _this.expiresIn) || other.expiresIn == _this.expiresIn));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as UploadPresign;
  return Object.hash(runtimeType,_this.uploadUrl,_this.r2Key,_this.expiresIn);
}

@override
String toString() {
  final _this = this as UploadPresign;
  return 'UploadPresign(uploadUrl: ${_this.uploadUrl}, r2Key: ${_this.r2Key}, expiresIn: ${_this.expiresIn})';
}


}

/// @nodoc
abstract mixin class $UploadPresignCopyWith<$Res>  {
  factory $UploadPresignCopyWith(UploadPresign value, $Res Function(UploadPresign) _then) = _$UploadPresignCopyWithImpl;
@useResult
$Res call({
 String uploadUrl, String r2Key, int expiresIn
});




}
/// @nodoc
class _$UploadPresignCopyWithImpl<$Res>
    implements $UploadPresignCopyWith<$Res> {
  _$UploadPresignCopyWithImpl(this._self, this._then);

  final UploadPresign _self;
  final $Res Function(UploadPresign) _then;

/// Create a copy of UploadPresign
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? uploadUrl = null,Object? r2Key = null,Object? expiresIn = null,}) {
  return _then(UploadPresign(
uploadUrl: null == uploadUrl ? _self.uploadUrl : uploadUrl // ignore: cast_nullable_to_non_nullable
as String,r2Key: null == r2Key ? _self.r2Key : r2Key // ignore: cast_nullable_to_non_nullable
as String,expiresIn: null == expiresIn ? _self.expiresIn : expiresIn // ignore: cast_nullable_to_non_nullable
as int,
  ));
}

}


/// Adds pattern-matching-related methods to [UploadPresign].
extension UploadPresignPatterns on UploadPresign {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _UploadPresign value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _UploadPresign() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _UploadPresign value)  $default,){
final _that = this;
switch (_that) {
case _UploadPresign():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _UploadPresign value)?  $default,){
final _that = this;
switch (_that) {
case _UploadPresign() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String uploadUrl,  String r2Key,  int expiresIn)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _UploadPresign() when $default != null:
return $default(_that.uploadUrl,_that.r2Key,_that.expiresIn);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String uploadUrl,  String r2Key,  int expiresIn)  $default,) {final _that = this;
switch (_that) {
case _UploadPresign():
return $default(_that.uploadUrl,_that.r2Key,_that.expiresIn);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String uploadUrl,  String r2Key,  int expiresIn)?  $default,) {final _that = this;
switch (_that) {
case _UploadPresign() when $default != null:
return $default(_that.uploadUrl,_that.r2Key,_that.expiresIn);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _UploadPresign implements UploadPresign {
  const _UploadPresign({required this.uploadUrl, required this.r2Key, required this.expiresIn});
  factory _UploadPresign.fromJson(Map<String, dynamic> json) => _$UploadPresignFromJson(json);

@override final  String uploadUrl;
@override final  String r2Key;
@override final  int expiresIn;

/// Create a copy of UploadPresign
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$UploadPresignCopyWith<_UploadPresign> get copyWith => __$UploadPresignCopyWithImpl<_UploadPresign>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$UploadPresignToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _UploadPresign&&(identical(other.uploadUrl, uploadUrl) || other.uploadUrl == uploadUrl)&&(identical(other.r2Key, r2Key) || other.r2Key == r2Key)&&(identical(other.expiresIn, expiresIn) || other.expiresIn == expiresIn));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,uploadUrl,r2Key,expiresIn);
}

@override
String toString() {
    return 'UploadPresign(uploadUrl: $uploadUrl, r2Key: $r2Key, expiresIn: $expiresIn)';
}


}

/// @nodoc
abstract mixin class _$UploadPresignCopyWith<$Res> implements $UploadPresignCopyWith<$Res> {
  factory _$UploadPresignCopyWith(_UploadPresign value, $Res Function(_UploadPresign) _then) = __$UploadPresignCopyWithImpl;
@override @useResult
$Res call({
 String uploadUrl, String r2Key, int expiresIn
});




}
/// @nodoc
class __$UploadPresignCopyWithImpl<$Res>
    implements _$UploadPresignCopyWith<$Res> {
  __$UploadPresignCopyWithImpl(this._self, this._then);

  final _UploadPresign _self;
  final $Res Function(_UploadPresign) _then;

/// Create a copy of UploadPresign
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? uploadUrl = null,Object? r2Key = null,Object? expiresIn = null,}) {
  return _then(_UploadPresign(
uploadUrl: null == uploadUrl ? _self.uploadUrl : uploadUrl // ignore: cast_nullable_to_non_nullable
as String,r2Key: null == r2Key ? _self.r2Key : r2Key // ignore: cast_nullable_to_non_nullable
as String,expiresIn: null == expiresIn ? _self.expiresIn : expiresIn // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}

// dart format on
