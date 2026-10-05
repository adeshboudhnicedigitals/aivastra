// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'tryon_submit_result.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$TryonSubmitResult {

 String get catalogueId; List<String> get jobIds; List<String>? get poseIds; String? get gender; String? get garmentTypeId;
/// Create a copy of TryonSubmitResult
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$TryonSubmitResultCopyWith<TryonSubmitResult> get copyWith => _$TryonSubmitResultCopyWithImpl<TryonSubmitResult>(this as TryonSubmitResult, _$identity);

  /// Serializes this TryonSubmitResult to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as TryonSubmitResult;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is TryonSubmitResult&&(identical(other.catalogueId, _this.catalogueId) || other.catalogueId == _this.catalogueId)&&const DeepCollectionEquality().equals(other.jobIds, _this.jobIds)&&const DeepCollectionEquality().equals(other.poseIds, _this.poseIds)&&(identical(other.gender, _this.gender) || other.gender == _this.gender)&&(identical(other.garmentTypeId, _this.garmentTypeId) || other.garmentTypeId == _this.garmentTypeId));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as TryonSubmitResult;
  return Object.hash(runtimeType,_this.catalogueId,const DeepCollectionEquality().hash(_this.jobIds),const DeepCollectionEquality().hash(_this.poseIds),_this.gender,_this.garmentTypeId);
}

@override
String toString() {
  final _this = this as TryonSubmitResult;
  return 'TryonSubmitResult(catalogueId: ${_this.catalogueId}, jobIds: ${_this.jobIds}, poseIds: ${_this.poseIds}, gender: ${_this.gender}, garmentTypeId: ${_this.garmentTypeId})';
}


}

/// @nodoc
abstract mixin class $TryonSubmitResultCopyWith<$Res>  {
  factory $TryonSubmitResultCopyWith(TryonSubmitResult value, $Res Function(TryonSubmitResult) _then) = _$TryonSubmitResultCopyWithImpl;
@useResult
$Res call({
 String catalogueId, List<String> jobIds, List<String>? poseIds, String? gender, String? garmentTypeId
});




}
/// @nodoc
class _$TryonSubmitResultCopyWithImpl<$Res>
    implements $TryonSubmitResultCopyWith<$Res> {
  _$TryonSubmitResultCopyWithImpl(this._self, this._then);

  final TryonSubmitResult _self;
  final $Res Function(TryonSubmitResult) _then;

/// Create a copy of TryonSubmitResult
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? catalogueId = null,Object? jobIds = null,Object? poseIds = freezed,Object? gender = freezed,Object? garmentTypeId = freezed,}) {
  return _then(TryonSubmitResult(
catalogueId: null == catalogueId ? _self.catalogueId : catalogueId // ignore: cast_nullable_to_non_nullable
as String,jobIds: null == jobIds ? _self.jobIds : jobIds // ignore: cast_nullable_to_non_nullable
as List<String>,poseIds: freezed == poseIds ? _self.poseIds : poseIds // ignore: cast_nullable_to_non_nullable
as List<String>?,gender: freezed == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as String?,garmentTypeId: freezed == garmentTypeId ? _self.garmentTypeId : garmentTypeId // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [TryonSubmitResult].
extension TryonSubmitResultPatterns on TryonSubmitResult {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _TryonSubmitResult value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _TryonSubmitResult() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _TryonSubmitResult value)  $default,){
final _that = this;
switch (_that) {
case _TryonSubmitResult():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _TryonSubmitResult value)?  $default,){
final _that = this;
switch (_that) {
case _TryonSubmitResult() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String catalogueId,  List<String> jobIds,  List<String>? poseIds,  String? gender,  String? garmentTypeId)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _TryonSubmitResult() when $default != null:
return $default(_that.catalogueId,_that.jobIds,_that.poseIds,_that.gender,_that.garmentTypeId);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String catalogueId,  List<String> jobIds,  List<String>? poseIds,  String? gender,  String? garmentTypeId)  $default,) {final _that = this;
switch (_that) {
case _TryonSubmitResult():
return $default(_that.catalogueId,_that.jobIds,_that.poseIds,_that.gender,_that.garmentTypeId);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String catalogueId,  List<String> jobIds,  List<String>? poseIds,  String? gender,  String? garmentTypeId)?  $default,) {final _that = this;
switch (_that) {
case _TryonSubmitResult() when $default != null:
return $default(_that.catalogueId,_that.jobIds,_that.poseIds,_that.gender,_that.garmentTypeId);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _TryonSubmitResult implements TryonSubmitResult {
  const _TryonSubmitResult({required this.catalogueId, required  List<String> jobIds,  List<String>? poseIds, this.gender, this.garmentTypeId}): _jobIds = jobIds,_poseIds = poseIds;
  factory _TryonSubmitResult.fromJson(Map<String, dynamic> json) => _$TryonSubmitResultFromJson(json);

@override final  String catalogueId;
 final  List<String> _jobIds;
@override List<String> get jobIds {
  if (_jobIds is EqualUnmodifiableListView) return _jobIds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_jobIds);
}

 final  List<String>? _poseIds;
@override List<String>? get poseIds {
  final value = _poseIds;
  if (value == null) return null;
  if (_poseIds is EqualUnmodifiableListView) return _poseIds;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(value);
}

@override final  String? gender;
@override final  String? garmentTypeId;

/// Create a copy of TryonSubmitResult
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$TryonSubmitResultCopyWith<_TryonSubmitResult> get copyWith => __$TryonSubmitResultCopyWithImpl<_TryonSubmitResult>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$TryonSubmitResultToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _TryonSubmitResult&&(identical(other.catalogueId, catalogueId) || other.catalogueId == catalogueId)&&const DeepCollectionEquality().equals(other.jobIds, _jobIds)&&const DeepCollectionEquality().equals(other.poseIds, _poseIds)&&(identical(other.gender, gender) || other.gender == gender)&&(identical(other.garmentTypeId, garmentTypeId) || other.garmentTypeId == garmentTypeId));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,catalogueId,const DeepCollectionEquality().hash(_jobIds),const DeepCollectionEquality().hash(_poseIds),gender,garmentTypeId);
}

@override
String toString() {
    return 'TryonSubmitResult(catalogueId: $catalogueId, jobIds: $jobIds, poseIds: $poseIds, gender: $gender, garmentTypeId: $garmentTypeId)';
}


}

/// @nodoc
abstract mixin class _$TryonSubmitResultCopyWith<$Res> implements $TryonSubmitResultCopyWith<$Res> {
  factory _$TryonSubmitResultCopyWith(_TryonSubmitResult value, $Res Function(_TryonSubmitResult) _then) = __$TryonSubmitResultCopyWithImpl;
@override @useResult
$Res call({
 String catalogueId, List<String> jobIds, List<String>? poseIds, String? gender, String? garmentTypeId
});




}
/// @nodoc
class __$TryonSubmitResultCopyWithImpl<$Res>
    implements _$TryonSubmitResultCopyWith<$Res> {
  __$TryonSubmitResultCopyWithImpl(this._self, this._then);

  final _TryonSubmitResult _self;
  final $Res Function(_TryonSubmitResult) _then;

/// Create a copy of TryonSubmitResult
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? catalogueId = null,Object? jobIds = null,Object? poseIds = freezed,Object? gender = freezed,Object? garmentTypeId = freezed,}) {
  return _then(_TryonSubmitResult(
catalogueId: null == catalogueId ? _self.catalogueId : catalogueId // ignore: cast_nullable_to_non_nullable
as String,jobIds: null == jobIds ? _self._jobIds : jobIds // ignore: cast_nullable_to_non_nullable
as List<String>,poseIds: freezed == poseIds ? _self._poseIds : poseIds // ignore: cast_nullable_to_non_nullable
as List<String>?,gender: freezed == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as String?,garmentTypeId: freezed == garmentTypeId ? _self.garmentTypeId : garmentTypeId // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
