// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'active_device_info.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$ActiveDeviceInfo {

 String get id; String get platform; String get deviceId; String? get deviceName; String get createdAt; String get expiresAt;
/// Create a copy of ActiveDeviceInfo
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$ActiveDeviceInfoCopyWith<ActiveDeviceInfo> get copyWith => _$ActiveDeviceInfoCopyWithImpl<ActiveDeviceInfo>(this as ActiveDeviceInfo, _$identity);

  /// Serializes this ActiveDeviceInfo to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as ActiveDeviceInfo;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is ActiveDeviceInfo&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.platform, _this.platform) || other.platform == _this.platform)&&(identical(other.deviceId, _this.deviceId) || other.deviceId == _this.deviceId)&&(identical(other.deviceName, _this.deviceName) || other.deviceName == _this.deviceName)&&(identical(other.createdAt, _this.createdAt) || other.createdAt == _this.createdAt)&&(identical(other.expiresAt, _this.expiresAt) || other.expiresAt == _this.expiresAt));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as ActiveDeviceInfo;
  return Object.hash(runtimeType,_this.id,_this.platform,_this.deviceId,_this.deviceName,_this.createdAt,_this.expiresAt);
}

@override
String toString() {
  final _this = this as ActiveDeviceInfo;
  return 'ActiveDeviceInfo(id: ${_this.id}, platform: ${_this.platform}, deviceId: ${_this.deviceId}, deviceName: ${_this.deviceName}, createdAt: ${_this.createdAt}, expiresAt: ${_this.expiresAt})';
}


}

/// @nodoc
abstract mixin class $ActiveDeviceInfoCopyWith<$Res>  {
  factory $ActiveDeviceInfoCopyWith(ActiveDeviceInfo value, $Res Function(ActiveDeviceInfo) _then) = _$ActiveDeviceInfoCopyWithImpl;
@useResult
$Res call({
 String id, String platform, String deviceId, String? deviceName, String createdAt, String expiresAt
});




}
/// @nodoc
class _$ActiveDeviceInfoCopyWithImpl<$Res>
    implements $ActiveDeviceInfoCopyWith<$Res> {
  _$ActiveDeviceInfoCopyWithImpl(this._self, this._then);

  final ActiveDeviceInfo _self;
  final $Res Function(ActiveDeviceInfo) _then;

/// Create a copy of ActiveDeviceInfo
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? platform = null,Object? deviceId = null,Object? deviceName = freezed,Object? createdAt = null,Object? expiresAt = null,}) {
  return _then(ActiveDeviceInfo(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,platform: null == platform ? _self.platform : platform // ignore: cast_nullable_to_non_nullable
as String,deviceId: null == deviceId ? _self.deviceId : deviceId // ignore: cast_nullable_to_non_nullable
as String,deviceName: freezed == deviceName ? _self.deviceName : deviceName // ignore: cast_nullable_to_non_nullable
as String?,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,expiresAt: null == expiresAt ? _self.expiresAt : expiresAt // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [ActiveDeviceInfo].
extension ActiveDeviceInfoPatterns on ActiveDeviceInfo {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _ActiveDeviceInfo value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _ActiveDeviceInfo() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _ActiveDeviceInfo value)  $default,){
final _that = this;
switch (_that) {
case _ActiveDeviceInfo():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _ActiveDeviceInfo value)?  $default,){
final _that = this;
switch (_that) {
case _ActiveDeviceInfo() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String platform,  String deviceId,  String? deviceName,  String createdAt,  String expiresAt)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _ActiveDeviceInfo() when $default != null:
return $default(_that.id,_that.platform,_that.deviceId,_that.deviceName,_that.createdAt,_that.expiresAt);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String platform,  String deviceId,  String? deviceName,  String createdAt,  String expiresAt)  $default,) {final _that = this;
switch (_that) {
case _ActiveDeviceInfo():
return $default(_that.id,_that.platform,_that.deviceId,_that.deviceName,_that.createdAt,_that.expiresAt);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String platform,  String deviceId,  String? deviceName,  String createdAt,  String expiresAt)?  $default,) {final _that = this;
switch (_that) {
case _ActiveDeviceInfo() when $default != null:
return $default(_that.id,_that.platform,_that.deviceId,_that.deviceName,_that.createdAt,_that.expiresAt);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _ActiveDeviceInfo implements ActiveDeviceInfo {
  const _ActiveDeviceInfo({required this.id, required this.platform, required this.deviceId, this.deviceName, required this.createdAt, required this.expiresAt});
  factory _ActiveDeviceInfo.fromJson(Map<String, dynamic> json) => _$ActiveDeviceInfoFromJson(json);

@override final  String id;
@override final  String platform;
@override final  String deviceId;
@override final  String? deviceName;
@override final  String createdAt;
@override final  String expiresAt;

/// Create a copy of ActiveDeviceInfo
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$ActiveDeviceInfoCopyWith<_ActiveDeviceInfo> get copyWith => __$ActiveDeviceInfoCopyWithImpl<_ActiveDeviceInfo>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$ActiveDeviceInfoToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _ActiveDeviceInfo&&(identical(other.id, id) || other.id == id)&&(identical(other.platform, platform) || other.platform == platform)&&(identical(other.deviceId, deviceId) || other.deviceId == deviceId)&&(identical(other.deviceName, deviceName) || other.deviceName == deviceName)&&(identical(other.createdAt, createdAt) || other.createdAt == createdAt)&&(identical(other.expiresAt, expiresAt) || other.expiresAt == expiresAt));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,platform,deviceId,deviceName,createdAt,expiresAt);
}

@override
String toString() {
    return 'ActiveDeviceInfo(id: $id, platform: $platform, deviceId: $deviceId, deviceName: $deviceName, createdAt: $createdAt, expiresAt: $expiresAt)';
}


}

/// @nodoc
abstract mixin class _$ActiveDeviceInfoCopyWith<$Res> implements $ActiveDeviceInfoCopyWith<$Res> {
  factory _$ActiveDeviceInfoCopyWith(_ActiveDeviceInfo value, $Res Function(_ActiveDeviceInfo) _then) = __$ActiveDeviceInfoCopyWithImpl;
@override @useResult
$Res call({
 String id, String platform, String deviceId, String? deviceName, String createdAt, String expiresAt
});




}
/// @nodoc
class __$ActiveDeviceInfoCopyWithImpl<$Res>
    implements _$ActiveDeviceInfoCopyWith<$Res> {
  __$ActiveDeviceInfoCopyWithImpl(this._self, this._then);

  final _ActiveDeviceInfo _self;
  final $Res Function(_ActiveDeviceInfo) _then;

/// Create a copy of ActiveDeviceInfo
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? platform = null,Object? deviceId = null,Object? deviceName = freezed,Object? createdAt = null,Object? expiresAt = null,}) {
  return _then(_ActiveDeviceInfo(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,platform: null == platform ? _self.platform : platform // ignore: cast_nullable_to_non_nullable
as String,deviceId: null == deviceId ? _self.deviceId : deviceId // ignore: cast_nullable_to_non_nullable
as String,deviceName: freezed == deviceName ? _self.deviceName : deviceName // ignore: cast_nullable_to_non_nullable
as String?,createdAt: null == createdAt ? _self.createdAt : createdAt // ignore: cast_nullable_to_non_nullable
as String,expiresAt: null == expiresAt ? _self.expiresAt : expiresAt // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

// dart format on
