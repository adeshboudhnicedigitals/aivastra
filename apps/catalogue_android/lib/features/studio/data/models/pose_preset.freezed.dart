// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'pose_preset.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$PosePreset {

 String get id; String get name; String get gender; String get garmentTypeId; List<String> get poseIds; bool get isLastUsed; String get updatedAt;
/// Create a copy of PosePreset
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$PosePresetCopyWith<PosePreset> get copyWith => _$PosePresetCopyWithImpl<PosePreset>(this as PosePreset, _$identity);

  /// Serializes this PosePreset to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as PosePreset;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is PosePreset&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.name, _this.name) || other.name == _this.name)&&(identical(other.gender, _this.gender) || other.gender == _this.gender)&&(identical(other.garmentTypeId, _this.garmentTypeId) || other.garmentTypeId == _this.garmentTypeId)&&const DeepCollectionEquality().equals(other.poseIds, _this.poseIds)&&(identical(other.isLastUsed, _this.isLastUsed) || other.isLastUsed == _this.isLastUsed)&&(identical(other.updatedAt, _this.updatedAt) || other.updatedAt == _this.updatedAt));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as PosePreset;
  return Object.hash(runtimeType,_this.id,_this.name,_this.gender,_this.garmentTypeId,const DeepCollectionEquality().hash(_this.poseIds),_this.isLastUsed,_this.updatedAt);
}

@override
String toString() {
  final _this = this as PosePreset;
  return 'PosePreset(id: ${_this.id}, name: ${_this.name}, gender: ${_this.gender}, garmentTypeId: ${_this.garmentTypeId}, poseIds: ${_this.poseIds}, isLastUsed: ${_this.isLastUsed}, updatedAt: ${_this.updatedAt})';
}


}

/// @nodoc
abstract mixin class $PosePresetCopyWith<$Res>  {
  factory $PosePresetCopyWith(PosePreset value, $Res Function(PosePreset) _then) = _$PosePresetCopyWithImpl;
@useResult
$Res call({
 String id, String name, String gender, String garmentTypeId, List<String> poseIds, bool isLastUsed, String updatedAt
});




}
/// @nodoc
class _$PosePresetCopyWithImpl<$Res>
    implements $PosePresetCopyWith<$Res> {
  _$PosePresetCopyWithImpl(this._self, this._then);

  final PosePreset _self;
  final $Res Function(PosePreset) _then;

/// Create a copy of PosePreset
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? name = null,Object? gender = null,Object? garmentTypeId = null,Object? poseIds = null,Object? isLastUsed = null,Object? updatedAt = null,}) {
  return _then(PosePreset(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,gender: null == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as String,garmentTypeId: null == garmentTypeId ? _self.garmentTypeId : garmentTypeId // ignore: cast_nullable_to_non_nullable
as String,poseIds: null == poseIds ? _self.poseIds : poseIds // ignore: cast_nullable_to_non_nullable
as List<String>,isLastUsed: null == isLastUsed ? _self.isLastUsed : isLastUsed // ignore: cast_nullable_to_non_nullable
as bool,updatedAt: null == updatedAt ? _self.updatedAt : updatedAt // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [PosePreset].
extension PosePresetPatterns on PosePreset {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _PosePreset value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _PosePreset() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _PosePreset value)  $default,){
final _that = this;
switch (_that) {
case _PosePreset():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _PosePreset value)?  $default,){
final _that = this;
switch (_that) {
case _PosePreset() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String name,  String gender,  String garmentTypeId,  List<String> poseIds,  bool isLastUsed,  String updatedAt)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _PosePreset() when $default != null:
return $default(_that.id,_that.name,_that.gender,_that.garmentTypeId,_that.poseIds,_that.isLastUsed,_that.updatedAt);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String name,  String gender,  String garmentTypeId,  List<String> poseIds,  bool isLastUsed,  String updatedAt)  $default,) {final _that = this;
switch (_that) {
case _PosePreset():
return $default(_that.id,_that.name,_that.gender,_that.garmentTypeId,_that.poseIds,_that.isLastUsed,_that.updatedAt);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String name,  String gender,  String garmentTypeId,  List<String> poseIds,  bool isLastUsed,  String updatedAt)?  $default,) {final _that = this;
switch (_that) {
case _PosePreset() when $default != null:
return $default(_that.id,_that.name,_that.gender,_that.garmentTypeId,_that.poseIds,_that.isLastUsed,_that.updatedAt);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _PosePreset implements PosePreset {
  const _PosePreset({required this.id, required this.name, required this.gender, required this.garmentTypeId, required  List<String> poseIds, this.isLastUsed = false, required this.updatedAt}): _poseIds = poseIds;
  factory _PosePreset.fromJson(Map<String, dynamic> json) => _$PosePresetFromJson(json);

@override final  String id;
@override final  String name;
@override final  String gender;
@override final  String garmentTypeId;
 final  List<String> _poseIds;
@override List<String> get poseIds {
  if (_poseIds is EqualUnmodifiableListView) return _poseIds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_poseIds);
}

@override@JsonKey() final  bool isLastUsed;
@override final  String updatedAt;

/// Create a copy of PosePreset
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$PosePresetCopyWith<_PosePreset> get copyWith => __$PosePresetCopyWithImpl<_PosePreset>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$PosePresetToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _PosePreset&&(identical(other.id, id) || other.id == id)&&(identical(other.name, name) || other.name == name)&&(identical(other.gender, gender) || other.gender == gender)&&(identical(other.garmentTypeId, garmentTypeId) || other.garmentTypeId == garmentTypeId)&&const DeepCollectionEquality().equals(other.poseIds, _poseIds)&&(identical(other.isLastUsed, isLastUsed) || other.isLastUsed == isLastUsed)&&(identical(other.updatedAt, updatedAt) || other.updatedAt == updatedAt));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,name,gender,garmentTypeId,const DeepCollectionEquality().hash(_poseIds),isLastUsed,updatedAt);
}

@override
String toString() {
    return 'PosePreset(id: $id, name: $name, gender: $gender, garmentTypeId: $garmentTypeId, poseIds: $poseIds, isLastUsed: $isLastUsed, updatedAt: $updatedAt)';
}


}

/// @nodoc
abstract mixin class _$PosePresetCopyWith<$Res> implements $PosePresetCopyWith<$Res> {
  factory _$PosePresetCopyWith(_PosePreset value, $Res Function(_PosePreset) _then) = __$PosePresetCopyWithImpl;
@override @useResult
$Res call({
 String id, String name, String gender, String garmentTypeId, List<String> poseIds, bool isLastUsed, String updatedAt
});




}
/// @nodoc
class __$PosePresetCopyWithImpl<$Res>
    implements _$PosePresetCopyWith<$Res> {
  __$PosePresetCopyWithImpl(this._self, this._then);

  final _PosePreset _self;
  final $Res Function(_PosePreset) _then;

/// Create a copy of PosePreset
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? name = null,Object? gender = null,Object? garmentTypeId = null,Object? poseIds = null,Object? isLastUsed = null,Object? updatedAt = null,}) {
  return _then(_PosePreset(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,name: null == name ? _self.name : name // ignore: cast_nullable_to_non_nullable
as String,gender: null == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as String,garmentTypeId: null == garmentTypeId ? _self.garmentTypeId : garmentTypeId // ignore: cast_nullable_to_non_nullable
as String,poseIds: null == poseIds ? _self._poseIds : poseIds // ignore: cast_nullable_to_non_nullable
as List<String>,isLastUsed: null == isLastUsed ? _self.isLastUsed : isLastUsed // ignore: cast_nullable_to_non_nullable
as bool,updatedAt: null == updatedAt ? _self.updatedAt : updatedAt // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}


/// @nodoc
mixin _$PosePresetsResponse {

 PosePreset? get lastUsed; List<PosePreset> get named;
/// Create a copy of PosePresetsResponse
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$PosePresetsResponseCopyWith<PosePresetsResponse> get copyWith => _$PosePresetsResponseCopyWithImpl<PosePresetsResponse>(this as PosePresetsResponse, _$identity);

  /// Serializes this PosePresetsResponse to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as PosePresetsResponse;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is PosePresetsResponse&&(identical(other.lastUsed, _this.lastUsed) || other.lastUsed == _this.lastUsed)&&const DeepCollectionEquality().equals(other.named, _this.named));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as PosePresetsResponse;
  return Object.hash(runtimeType,_this.lastUsed,const DeepCollectionEquality().hash(_this.named));
}

@override
String toString() {
  final _this = this as PosePresetsResponse;
  return 'PosePresetsResponse(lastUsed: ${_this.lastUsed}, named: ${_this.named})';
}


}

/// @nodoc
abstract mixin class $PosePresetsResponseCopyWith<$Res>  {
  factory $PosePresetsResponseCopyWith(PosePresetsResponse value, $Res Function(PosePresetsResponse) _then) = _$PosePresetsResponseCopyWithImpl;
@useResult
$Res call({
 PosePreset? lastUsed, List<PosePreset> named
});


$PosePresetCopyWith<$Res>? get lastUsed;

}
/// @nodoc
class _$PosePresetsResponseCopyWithImpl<$Res>
    implements $PosePresetsResponseCopyWith<$Res> {
  _$PosePresetsResponseCopyWithImpl(this._self, this._then);

  final PosePresetsResponse _self;
  final $Res Function(PosePresetsResponse) _then;

/// Create a copy of PosePresetsResponse
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? lastUsed = freezed,Object? named = null,}) {
  return _then(PosePresetsResponse(
lastUsed: freezed == lastUsed ? _self.lastUsed : lastUsed // ignore: cast_nullable_to_non_nullable
as PosePreset?,named: null == named ? _self.named : named // ignore: cast_nullable_to_non_nullable
as List<PosePreset>,
  ));
}
/// Create a copy of PosePresetsResponse
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$PosePresetCopyWith<$Res>? get lastUsed {
    if (_self.lastUsed == null) {
    return null;
  }

  return $PosePresetCopyWith<$Res>(_self.lastUsed!, (value) {
    return _then(_self.copyWith(lastUsed: value));
  });
}
}


/// Adds pattern-matching-related methods to [PosePresetsResponse].
extension PosePresetsResponsePatterns on PosePresetsResponse {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _PosePresetsResponse value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _PosePresetsResponse() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _PosePresetsResponse value)  $default,){
final _that = this;
switch (_that) {
case _PosePresetsResponse():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _PosePresetsResponse value)?  $default,){
final _that = this;
switch (_that) {
case _PosePresetsResponse() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( PosePreset? lastUsed,  List<PosePreset> named)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _PosePresetsResponse() when $default != null:
return $default(_that.lastUsed,_that.named);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( PosePreset? lastUsed,  List<PosePreset> named)  $default,) {final _that = this;
switch (_that) {
case _PosePresetsResponse():
return $default(_that.lastUsed,_that.named);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( PosePreset? lastUsed,  List<PosePreset> named)?  $default,) {final _that = this;
switch (_that) {
case _PosePresetsResponse() when $default != null:
return $default(_that.lastUsed,_that.named);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _PosePresetsResponse implements PosePresetsResponse {
  const _PosePresetsResponse({this.lastUsed, required  List<PosePreset> named}): _named = named;
  factory _PosePresetsResponse.fromJson(Map<String, dynamic> json) => _$PosePresetsResponseFromJson(json);

@override final  PosePreset? lastUsed;
 final  List<PosePreset> _named;
@override List<PosePreset> get named {
  if (_named is EqualUnmodifiableListView) return _named;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_named);
}


/// Create a copy of PosePresetsResponse
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$PosePresetsResponseCopyWith<_PosePresetsResponse> get copyWith => __$PosePresetsResponseCopyWithImpl<_PosePresetsResponse>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$PosePresetsResponseToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _PosePresetsResponse&&(identical(other.lastUsed, lastUsed) || other.lastUsed == lastUsed)&&const DeepCollectionEquality().equals(other.named, _named));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,lastUsed,const DeepCollectionEquality().hash(_named));
}

@override
String toString() {
    return 'PosePresetsResponse(lastUsed: $lastUsed, named: $named)';
}


}

/// @nodoc
abstract mixin class _$PosePresetsResponseCopyWith<$Res> implements $PosePresetsResponseCopyWith<$Res> {
  factory _$PosePresetsResponseCopyWith(_PosePresetsResponse value, $Res Function(_PosePresetsResponse) _then) = __$PosePresetsResponseCopyWithImpl;
@override @useResult
$Res call({
 PosePreset? lastUsed, List<PosePreset> named
});


@override $PosePresetCopyWith<$Res>? get lastUsed;

}
/// @nodoc
class __$PosePresetsResponseCopyWithImpl<$Res>
    implements _$PosePresetsResponseCopyWith<$Res> {
  __$PosePresetsResponseCopyWithImpl(this._self, this._then);

  final _PosePresetsResponse _self;
  final $Res Function(_PosePresetsResponse) _then;

/// Create a copy of PosePresetsResponse
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? lastUsed = freezed,Object? named = null,}) {
  return _then(_PosePresetsResponse(
lastUsed: freezed == lastUsed ? _self.lastUsed : lastUsed // ignore: cast_nullable_to_non_nullable
as PosePreset?,named: null == named ? _self._named : named // ignore: cast_nullable_to_non_nullable
as List<PosePreset>,
  ));
}

/// Create a copy of PosePresetsResponse
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$PosePresetCopyWith<$Res>? get lastUsed {
    if (_self.lastUsed == null) {
    return null;
  }

  return $PosePresetCopyWith<$Res>(_self.lastUsed!, (value) {
    return _then(_self.copyWith(lastUsed: value));
  });
}
}

// dart format on
