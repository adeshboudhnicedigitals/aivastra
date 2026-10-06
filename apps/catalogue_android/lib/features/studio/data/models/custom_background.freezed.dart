// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'custom_background.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$CustomBackground {

 String get id; String get label; String get thumbnailUrl;
/// Create a copy of CustomBackground
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CustomBackgroundCopyWith<CustomBackground> get copyWith => _$CustomBackgroundCopyWithImpl<CustomBackground>(this as CustomBackground, _$identity);

  /// Serializes this CustomBackground to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CustomBackground;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CustomBackground&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CustomBackground;
  return Object.hash(runtimeType,_this.id,_this.label,_this.thumbnailUrl);
}

@override
String toString() {
  final _this = this as CustomBackground;
  return 'CustomBackground(id: ${_this.id}, label: ${_this.label}, thumbnailUrl: ${_this.thumbnailUrl})';
}


}

/// @nodoc
abstract mixin class $CustomBackgroundCopyWith<$Res>  {
  factory $CustomBackgroundCopyWith(CustomBackground value, $Res Function(CustomBackground) _then) = _$CustomBackgroundCopyWithImpl;
@useResult
$Res call({
 String id, String label, String thumbnailUrl
});




}
/// @nodoc
class _$CustomBackgroundCopyWithImpl<$Res>
    implements $CustomBackgroundCopyWith<$Res> {
  _$CustomBackgroundCopyWithImpl(this._self, this._then);

  final CustomBackground _self;
  final $Res Function(CustomBackground) _then;

/// Create a copy of CustomBackground
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? label = null,Object? thumbnailUrl = null,}) {
  return _then(CustomBackground(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [CustomBackground].
extension CustomBackgroundPatterns on CustomBackground {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CustomBackground value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CustomBackground() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CustomBackground value)  $default,){
final _that = this;
switch (_that) {
case _CustomBackground():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CustomBackground value)?  $default,){
final _that = this;
switch (_that) {
case _CustomBackground() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String label,  String thumbnailUrl)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CustomBackground() when $default != null:
return $default(_that.id,_that.label,_that.thumbnailUrl);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String label,  String thumbnailUrl)  $default,) {final _that = this;
switch (_that) {
case _CustomBackground():
return $default(_that.id,_that.label,_that.thumbnailUrl);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String label,  String thumbnailUrl)?  $default,) {final _that = this;
switch (_that) {
case _CustomBackground() when $default != null:
return $default(_that.id,_that.label,_that.thumbnailUrl);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CustomBackground implements CustomBackground {
  const _CustomBackground({required this.id, required this.label, required this.thumbnailUrl});
  factory _CustomBackground.fromJson(Map<String, dynamic> json) => _$CustomBackgroundFromJson(json);

@override final  String id;
@override final  String label;
@override final  String thumbnailUrl;

/// Create a copy of CustomBackground
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CustomBackgroundCopyWith<_CustomBackground> get copyWith => __$CustomBackgroundCopyWithImpl<_CustomBackground>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CustomBackgroundToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CustomBackground&&(identical(other.id, id) || other.id == id)&&(identical(other.label, label) || other.label == label)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,label,thumbnailUrl);
}

@override
String toString() {
    return 'CustomBackground(id: $id, label: $label, thumbnailUrl: $thumbnailUrl)';
}


}

/// @nodoc
abstract mixin class _$CustomBackgroundCopyWith<$Res> implements $CustomBackgroundCopyWith<$Res> {
  factory _$CustomBackgroundCopyWith(_CustomBackground value, $Res Function(_CustomBackground) _then) = __$CustomBackgroundCopyWithImpl;
@override @useResult
$Res call({
 String id, String label, String thumbnailUrl
});




}
/// @nodoc
class __$CustomBackgroundCopyWithImpl<$Res>
    implements _$CustomBackgroundCopyWith<$Res> {
  __$CustomBackgroundCopyWithImpl(this._self, this._then);

  final _CustomBackground _self;
  final $Res Function(_CustomBackground) _then;

/// Create a copy of CustomBackground
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? label = null,Object? thumbnailUrl = null,}) {
  return _then(_CustomBackground(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}


/// @nodoc
mixin _$BackgroundUploadPresign {

 String get uploadUrl; String get r2Key; String get id; int get expiresIn;
/// Create a copy of BackgroundUploadPresign
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$BackgroundUploadPresignCopyWith<BackgroundUploadPresign> get copyWith => _$BackgroundUploadPresignCopyWithImpl<BackgroundUploadPresign>(this as BackgroundUploadPresign, _$identity);

  /// Serializes this BackgroundUploadPresign to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as BackgroundUploadPresign;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is BackgroundUploadPresign&&(identical(other.uploadUrl, _this.uploadUrl) || other.uploadUrl == _this.uploadUrl)&&(identical(other.r2Key, _this.r2Key) || other.r2Key == _this.r2Key)&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.expiresIn, _this.expiresIn) || other.expiresIn == _this.expiresIn));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as BackgroundUploadPresign;
  return Object.hash(runtimeType,_this.uploadUrl,_this.r2Key,_this.id,_this.expiresIn);
}

@override
String toString() {
  final _this = this as BackgroundUploadPresign;
  return 'BackgroundUploadPresign(uploadUrl: ${_this.uploadUrl}, r2Key: ${_this.r2Key}, id: ${_this.id}, expiresIn: ${_this.expiresIn})';
}


}

/// @nodoc
abstract mixin class $BackgroundUploadPresignCopyWith<$Res>  {
  factory $BackgroundUploadPresignCopyWith(BackgroundUploadPresign value, $Res Function(BackgroundUploadPresign) _then) = _$BackgroundUploadPresignCopyWithImpl;
@useResult
$Res call({
 String uploadUrl, String r2Key, String id, int expiresIn
});




}
/// @nodoc
class _$BackgroundUploadPresignCopyWithImpl<$Res>
    implements $BackgroundUploadPresignCopyWith<$Res> {
  _$BackgroundUploadPresignCopyWithImpl(this._self, this._then);

  final BackgroundUploadPresign _self;
  final $Res Function(BackgroundUploadPresign) _then;

/// Create a copy of BackgroundUploadPresign
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? uploadUrl = null,Object? r2Key = null,Object? id = null,Object? expiresIn = null,}) {
  return _then(BackgroundUploadPresign(
uploadUrl: null == uploadUrl ? _self.uploadUrl : uploadUrl // ignore: cast_nullable_to_non_nullable
as String,r2Key: null == r2Key ? _self.r2Key : r2Key // ignore: cast_nullable_to_non_nullable
as String,id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,expiresIn: null == expiresIn ? _self.expiresIn : expiresIn // ignore: cast_nullable_to_non_nullable
as int,
  ));
}

}


/// Adds pattern-matching-related methods to [BackgroundUploadPresign].
extension BackgroundUploadPresignPatterns on BackgroundUploadPresign {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _BackgroundUploadPresign value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _BackgroundUploadPresign() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _BackgroundUploadPresign value)  $default,){
final _that = this;
switch (_that) {
case _BackgroundUploadPresign():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _BackgroundUploadPresign value)?  $default,){
final _that = this;
switch (_that) {
case _BackgroundUploadPresign() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String uploadUrl,  String r2Key,  String id,  int expiresIn)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _BackgroundUploadPresign() when $default != null:
return $default(_that.uploadUrl,_that.r2Key,_that.id,_that.expiresIn);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String uploadUrl,  String r2Key,  String id,  int expiresIn)  $default,) {final _that = this;
switch (_that) {
case _BackgroundUploadPresign():
return $default(_that.uploadUrl,_that.r2Key,_that.id,_that.expiresIn);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String uploadUrl,  String r2Key,  String id,  int expiresIn)?  $default,) {final _that = this;
switch (_that) {
case _BackgroundUploadPresign() when $default != null:
return $default(_that.uploadUrl,_that.r2Key,_that.id,_that.expiresIn);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _BackgroundUploadPresign implements BackgroundUploadPresign {
  const _BackgroundUploadPresign({required this.uploadUrl, required this.r2Key, required this.id, required this.expiresIn});
  factory _BackgroundUploadPresign.fromJson(Map<String, dynamic> json) => _$BackgroundUploadPresignFromJson(json);

@override final  String uploadUrl;
@override final  String r2Key;
@override final  String id;
@override final  int expiresIn;

/// Create a copy of BackgroundUploadPresign
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$BackgroundUploadPresignCopyWith<_BackgroundUploadPresign> get copyWith => __$BackgroundUploadPresignCopyWithImpl<_BackgroundUploadPresign>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$BackgroundUploadPresignToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _BackgroundUploadPresign&&(identical(other.uploadUrl, uploadUrl) || other.uploadUrl == uploadUrl)&&(identical(other.r2Key, r2Key) || other.r2Key == r2Key)&&(identical(other.id, id) || other.id == id)&&(identical(other.expiresIn, expiresIn) || other.expiresIn == expiresIn));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,uploadUrl,r2Key,id,expiresIn);
}

@override
String toString() {
    return 'BackgroundUploadPresign(uploadUrl: $uploadUrl, r2Key: $r2Key, id: $id, expiresIn: $expiresIn)';
}


}

/// @nodoc
abstract mixin class _$BackgroundUploadPresignCopyWith<$Res> implements $BackgroundUploadPresignCopyWith<$Res> {
  factory _$BackgroundUploadPresignCopyWith(_BackgroundUploadPresign value, $Res Function(_BackgroundUploadPresign) _then) = __$BackgroundUploadPresignCopyWithImpl;
@override @useResult
$Res call({
 String uploadUrl, String r2Key, String id, int expiresIn
});




}
/// @nodoc
class __$BackgroundUploadPresignCopyWithImpl<$Res>
    implements _$BackgroundUploadPresignCopyWith<$Res> {
  __$BackgroundUploadPresignCopyWithImpl(this._self, this._then);

  final _BackgroundUploadPresign _self;
  final $Res Function(_BackgroundUploadPresign) _then;

/// Create a copy of BackgroundUploadPresign
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? uploadUrl = null,Object? r2Key = null,Object? id = null,Object? expiresIn = null,}) {
  return _then(_BackgroundUploadPresign(
uploadUrl: null == uploadUrl ? _self.uploadUrl : uploadUrl // ignore: cast_nullable_to_non_nullable
as String,r2Key: null == r2Key ? _self.r2Key : r2Key // ignore: cast_nullable_to_non_nullable
as String,id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,expiresIn: null == expiresIn ? _self.expiresIn : expiresIn // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}

// dart format on
