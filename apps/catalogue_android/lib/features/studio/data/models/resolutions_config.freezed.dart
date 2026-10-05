// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'resolutions_config.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$ResolutionInfo {

 bool get enabled; int get creditCost; int get longEdgePx;
/// Create a copy of ResolutionInfo
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$ResolutionInfoCopyWith<ResolutionInfo> get copyWith => _$ResolutionInfoCopyWithImpl<ResolutionInfo>(this as ResolutionInfo, _$identity);

  /// Serializes this ResolutionInfo to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as ResolutionInfo;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is ResolutionInfo&&(identical(other.enabled, _this.enabled) || other.enabled == _this.enabled)&&(identical(other.creditCost, _this.creditCost) || other.creditCost == _this.creditCost)&&(identical(other.longEdgePx, _this.longEdgePx) || other.longEdgePx == _this.longEdgePx));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as ResolutionInfo;
  return Object.hash(runtimeType,_this.enabled,_this.creditCost,_this.longEdgePx);
}

@override
String toString() {
  final _this = this as ResolutionInfo;
  return 'ResolutionInfo(enabled: ${_this.enabled}, creditCost: ${_this.creditCost}, longEdgePx: ${_this.longEdgePx})';
}


}

/// @nodoc
abstract mixin class $ResolutionInfoCopyWith<$Res>  {
  factory $ResolutionInfoCopyWith(ResolutionInfo value, $Res Function(ResolutionInfo) _then) = _$ResolutionInfoCopyWithImpl;
@useResult
$Res call({
 bool enabled, int creditCost, int longEdgePx
});




}
/// @nodoc
class _$ResolutionInfoCopyWithImpl<$Res>
    implements $ResolutionInfoCopyWith<$Res> {
  _$ResolutionInfoCopyWithImpl(this._self, this._then);

  final ResolutionInfo _self;
  final $Res Function(ResolutionInfo) _then;

/// Create a copy of ResolutionInfo
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? enabled = null,Object? creditCost = null,Object? longEdgePx = null,}) {
  return _then(ResolutionInfo(
enabled: null == enabled ? _self.enabled : enabled // ignore: cast_nullable_to_non_nullable
as bool,creditCost: null == creditCost ? _self.creditCost : creditCost // ignore: cast_nullable_to_non_nullable
as int,longEdgePx: null == longEdgePx ? _self.longEdgePx : longEdgePx // ignore: cast_nullable_to_non_nullable
as int,
  ));
}

}


/// Adds pattern-matching-related methods to [ResolutionInfo].
extension ResolutionInfoPatterns on ResolutionInfo {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _ResolutionInfo value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _ResolutionInfo() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _ResolutionInfo value)  $default,){
final _that = this;
switch (_that) {
case _ResolutionInfo():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _ResolutionInfo value)?  $default,){
final _that = this;
switch (_that) {
case _ResolutionInfo() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( bool enabled,  int creditCost,  int longEdgePx)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _ResolutionInfo() when $default != null:
return $default(_that.enabled,_that.creditCost,_that.longEdgePx);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( bool enabled,  int creditCost,  int longEdgePx)  $default,) {final _that = this;
switch (_that) {
case _ResolutionInfo():
return $default(_that.enabled,_that.creditCost,_that.longEdgePx);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( bool enabled,  int creditCost,  int longEdgePx)?  $default,) {final _that = this;
switch (_that) {
case _ResolutionInfo() when $default != null:
return $default(_that.enabled,_that.creditCost,_that.longEdgePx);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _ResolutionInfo implements ResolutionInfo {
  const _ResolutionInfo({required this.enabled, required this.creditCost, required this.longEdgePx});
  factory _ResolutionInfo.fromJson(Map<String, dynamic> json) => _$ResolutionInfoFromJson(json);

@override final  bool enabled;
@override final  int creditCost;
@override final  int longEdgePx;

/// Create a copy of ResolutionInfo
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$ResolutionInfoCopyWith<_ResolutionInfo> get copyWith => __$ResolutionInfoCopyWithImpl<_ResolutionInfo>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$ResolutionInfoToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _ResolutionInfo&&(identical(other.enabled, enabled) || other.enabled == enabled)&&(identical(other.creditCost, creditCost) || other.creditCost == creditCost)&&(identical(other.longEdgePx, longEdgePx) || other.longEdgePx == longEdgePx));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,enabled,creditCost,longEdgePx);
}

@override
String toString() {
    return 'ResolutionInfo(enabled: $enabled, creditCost: $creditCost, longEdgePx: $longEdgePx)';
}


}

/// @nodoc
abstract mixin class _$ResolutionInfoCopyWith<$Res> implements $ResolutionInfoCopyWith<$Res> {
  factory _$ResolutionInfoCopyWith(_ResolutionInfo value, $Res Function(_ResolutionInfo) _then) = __$ResolutionInfoCopyWithImpl;
@override @useResult
$Res call({
 bool enabled, int creditCost, int longEdgePx
});




}
/// @nodoc
class __$ResolutionInfoCopyWithImpl<$Res>
    implements _$ResolutionInfoCopyWith<$Res> {
  __$ResolutionInfoCopyWithImpl(this._self, this._then);

  final _ResolutionInfo _self;
  final $Res Function(_ResolutionInfo) _then;

/// Create a copy of ResolutionInfo
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? enabled = null,Object? creditCost = null,Object? longEdgePx = null,}) {
  return _then(_ResolutionInfo(
enabled: null == enabled ? _self.enabled : enabled // ignore: cast_nullable_to_non_nullable
as bool,creditCost: null == creditCost ? _self.creditCost : creditCost // ignore: cast_nullable_to_non_nullable
as int,longEdgePx: null == longEdgePx ? _self.longEdgePx : longEdgePx // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}


/// @nodoc
mixin _$ResolutionsConfig {

 Map<String, ResolutionInfo> get resolutions;
/// Create a copy of ResolutionsConfig
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$ResolutionsConfigCopyWith<ResolutionsConfig> get copyWith => _$ResolutionsConfigCopyWithImpl<ResolutionsConfig>(this as ResolutionsConfig, _$identity);

  /// Serializes this ResolutionsConfig to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as ResolutionsConfig;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is ResolutionsConfig&&const DeepCollectionEquality().equals(other.resolutions, _this.resolutions));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as ResolutionsConfig;
  return Object.hash(runtimeType,const DeepCollectionEquality().hash(_this.resolutions));
}

@override
String toString() {
  final _this = this as ResolutionsConfig;
  return 'ResolutionsConfig(resolutions: ${_this.resolutions})';
}


}

/// @nodoc
abstract mixin class $ResolutionsConfigCopyWith<$Res>  {
  factory $ResolutionsConfigCopyWith(ResolutionsConfig value, $Res Function(ResolutionsConfig) _then) = _$ResolutionsConfigCopyWithImpl;
@useResult
$Res call({
 Map<String, ResolutionInfo> resolutions
});




}
/// @nodoc
class _$ResolutionsConfigCopyWithImpl<$Res>
    implements $ResolutionsConfigCopyWith<$Res> {
  _$ResolutionsConfigCopyWithImpl(this._self, this._then);

  final ResolutionsConfig _self;
  final $Res Function(ResolutionsConfig) _then;

/// Create a copy of ResolutionsConfig
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? resolutions = null,}) {
  return _then(ResolutionsConfig(
resolutions: null == resolutions ? _self.resolutions : resolutions // ignore: cast_nullable_to_non_nullable
as Map<String, ResolutionInfo>,
  ));
}

}


/// Adds pattern-matching-related methods to [ResolutionsConfig].
extension ResolutionsConfigPatterns on ResolutionsConfig {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _ResolutionsConfig value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _ResolutionsConfig() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _ResolutionsConfig value)  $default,){
final _that = this;
switch (_that) {
case _ResolutionsConfig():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _ResolutionsConfig value)?  $default,){
final _that = this;
switch (_that) {
case _ResolutionsConfig() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( Map<String, ResolutionInfo> resolutions)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _ResolutionsConfig() when $default != null:
return $default(_that.resolutions);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( Map<String, ResolutionInfo> resolutions)  $default,) {final _that = this;
switch (_that) {
case _ResolutionsConfig():
return $default(_that.resolutions);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( Map<String, ResolutionInfo> resolutions)?  $default,) {final _that = this;
switch (_that) {
case _ResolutionsConfig() when $default != null:
return $default(_that.resolutions);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _ResolutionsConfig implements ResolutionsConfig {
  const _ResolutionsConfig({required  Map<String, ResolutionInfo> resolutions}): _resolutions = resolutions;
  factory _ResolutionsConfig.fromJson(Map<String, dynamic> json) => _$ResolutionsConfigFromJson(json);

 final  Map<String, ResolutionInfo> _resolutions;
@override Map<String, ResolutionInfo> get resolutions {
  if (_resolutions is EqualUnmodifiableMapView) return _resolutions;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableMapView(_resolutions);
}


/// Create a copy of ResolutionsConfig
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$ResolutionsConfigCopyWith<_ResolutionsConfig> get copyWith => __$ResolutionsConfigCopyWithImpl<_ResolutionsConfig>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$ResolutionsConfigToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _ResolutionsConfig&&const DeepCollectionEquality().equals(other.resolutions, _resolutions));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_resolutions));
}

@override
String toString() {
    return 'ResolutionsConfig(resolutions: $resolutions)';
}


}

/// @nodoc
abstract mixin class _$ResolutionsConfigCopyWith<$Res> implements $ResolutionsConfigCopyWith<$Res> {
  factory _$ResolutionsConfigCopyWith(_ResolutionsConfig value, $Res Function(_ResolutionsConfig) _then) = __$ResolutionsConfigCopyWithImpl;
@override @useResult
$Res call({
 Map<String, ResolutionInfo> resolutions
});




}
/// @nodoc
class __$ResolutionsConfigCopyWithImpl<$Res>
    implements _$ResolutionsConfigCopyWith<$Res> {
  __$ResolutionsConfigCopyWithImpl(this._self, this._then);

  final _ResolutionsConfig _self;
  final $Res Function(_ResolutionsConfig) _then;

/// Create a copy of ResolutionsConfig
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? resolutions = null,}) {
  return _then(_ResolutionsConfig(
resolutions: null == resolutions ? _self._resolutions : resolutions // ignore: cast_nullable_to_non_nullable
as Map<String, ResolutionInfo>,
  ));
}


}

// dart format on
