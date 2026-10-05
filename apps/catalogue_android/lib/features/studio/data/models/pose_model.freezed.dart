// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'pose_model.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$PoseModel {

 String get id; String get label; String get thumbnailUrl; bool get hasLower; bool get hasShoes; bool get hasAspectRatio;
/// Create a copy of PoseModel
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$PoseModelCopyWith<PoseModel> get copyWith => _$PoseModelCopyWithImpl<PoseModel>(this as PoseModel, _$identity);

  /// Serializes this PoseModel to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as PoseModel;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is PoseModel&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl)&&(identical(other.hasLower, _this.hasLower) || other.hasLower == _this.hasLower)&&(identical(other.hasShoes, _this.hasShoes) || other.hasShoes == _this.hasShoes)&&(identical(other.hasAspectRatio, _this.hasAspectRatio) || other.hasAspectRatio == _this.hasAspectRatio));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as PoseModel;
  return Object.hash(runtimeType,_this.id,_this.label,_this.thumbnailUrl,_this.hasLower,_this.hasShoes,_this.hasAspectRatio);
}

@override
String toString() {
  final _this = this as PoseModel;
  return 'PoseModel(id: ${_this.id}, label: ${_this.label}, thumbnailUrl: ${_this.thumbnailUrl}, hasLower: ${_this.hasLower}, hasShoes: ${_this.hasShoes}, hasAspectRatio: ${_this.hasAspectRatio})';
}


}

/// @nodoc
abstract mixin class $PoseModelCopyWith<$Res>  {
  factory $PoseModelCopyWith(PoseModel value, $Res Function(PoseModel) _then) = _$PoseModelCopyWithImpl;
@useResult
$Res call({
 String id, String label, String thumbnailUrl, bool hasLower, bool hasShoes, bool hasAspectRatio
});




}
/// @nodoc
class _$PoseModelCopyWithImpl<$Res>
    implements $PoseModelCopyWith<$Res> {
  _$PoseModelCopyWithImpl(this._self, this._then);

  final PoseModel _self;
  final $Res Function(PoseModel) _then;

/// Create a copy of PoseModel
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? label = null,Object? thumbnailUrl = null,Object? hasLower = null,Object? hasShoes = null,Object? hasAspectRatio = null,}) {
  return _then(PoseModel(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,hasLower: null == hasLower ? _self.hasLower : hasLower // ignore: cast_nullable_to_non_nullable
as bool,hasShoes: null == hasShoes ? _self.hasShoes : hasShoes // ignore: cast_nullable_to_non_nullable
as bool,hasAspectRatio: null == hasAspectRatio ? _self.hasAspectRatio : hasAspectRatio // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}

}


/// Adds pattern-matching-related methods to [PoseModel].
extension PoseModelPatterns on PoseModel {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _PoseModel value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _PoseModel() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _PoseModel value)  $default,){
final _that = this;
switch (_that) {
case _PoseModel():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _PoseModel value)?  $default,){
final _that = this;
switch (_that) {
case _PoseModel() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String label,  String thumbnailUrl,  bool hasLower,  bool hasShoes,  bool hasAspectRatio)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _PoseModel() when $default != null:
return $default(_that.id,_that.label,_that.thumbnailUrl,_that.hasLower,_that.hasShoes,_that.hasAspectRatio);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String label,  String thumbnailUrl,  bool hasLower,  bool hasShoes,  bool hasAspectRatio)  $default,) {final _that = this;
switch (_that) {
case _PoseModel():
return $default(_that.id,_that.label,_that.thumbnailUrl,_that.hasLower,_that.hasShoes,_that.hasAspectRatio);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String label,  String thumbnailUrl,  bool hasLower,  bool hasShoes,  bool hasAspectRatio)?  $default,) {final _that = this;
switch (_that) {
case _PoseModel() when $default != null:
return $default(_that.id,_that.label,_that.thumbnailUrl,_that.hasLower,_that.hasShoes,_that.hasAspectRatio);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _PoseModel implements PoseModel {
  const _PoseModel({required this.id, required this.label, required this.thumbnailUrl, this.hasLower = false, this.hasShoes = false, this.hasAspectRatio = false});
  factory _PoseModel.fromJson(Map<String, dynamic> json) => _$PoseModelFromJson(json);

@override final  String id;
@override final  String label;
@override final  String thumbnailUrl;
@override@JsonKey() final  bool hasLower;
@override@JsonKey() final  bool hasShoes;
@override@JsonKey() final  bool hasAspectRatio;

/// Create a copy of PoseModel
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$PoseModelCopyWith<_PoseModel> get copyWith => __$PoseModelCopyWithImpl<_PoseModel>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$PoseModelToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _PoseModel&&(identical(other.id, id) || other.id == id)&&(identical(other.label, label) || other.label == label)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl)&&(identical(other.hasLower, hasLower) || other.hasLower == hasLower)&&(identical(other.hasShoes, hasShoes) || other.hasShoes == hasShoes)&&(identical(other.hasAspectRatio, hasAspectRatio) || other.hasAspectRatio == hasAspectRatio));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,label,thumbnailUrl,hasLower,hasShoes,hasAspectRatio);
}

@override
String toString() {
    return 'PoseModel(id: $id, label: $label, thumbnailUrl: $thumbnailUrl, hasLower: $hasLower, hasShoes: $hasShoes, hasAspectRatio: $hasAspectRatio)';
}


}

/// @nodoc
abstract mixin class _$PoseModelCopyWith<$Res> implements $PoseModelCopyWith<$Res> {
  factory _$PoseModelCopyWith(_PoseModel value, $Res Function(_PoseModel) _then) = __$PoseModelCopyWithImpl;
@override @useResult
$Res call({
 String id, String label, String thumbnailUrl, bool hasLower, bool hasShoes, bool hasAspectRatio
});




}
/// @nodoc
class __$PoseModelCopyWithImpl<$Res>
    implements _$PoseModelCopyWith<$Res> {
  __$PoseModelCopyWithImpl(this._self, this._then);

  final _PoseModel _self;
  final $Res Function(_PoseModel) _then;

/// Create a copy of PoseModel
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? label = null,Object? thumbnailUrl = null,Object? hasLower = null,Object? hasShoes = null,Object? hasAspectRatio = null,}) {
  return _then(_PoseModel(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,hasLower: null == hasLower ? _self.hasLower : hasLower // ignore: cast_nullable_to_non_nullable
as bool,hasShoes: null == hasShoes ? _self.hasShoes : hasShoes // ignore: cast_nullable_to_non_nullable
as bool,hasAspectRatio: null == hasAspectRatio ? _self.hasAspectRatio : hasAspectRatio // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}

// dart format on
