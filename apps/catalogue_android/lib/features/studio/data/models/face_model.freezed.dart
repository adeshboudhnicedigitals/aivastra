// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'face_model.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$FaceModel {

 String get id; String get gender; String get label; String? get continent; String get thumbnailUrl; List<String>? get tags;
/// Create a copy of FaceModel
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$FaceModelCopyWith<FaceModel> get copyWith => _$FaceModelCopyWithImpl<FaceModel>(this as FaceModel, _$identity);

  /// Serializes this FaceModel to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as FaceModel;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is FaceModel&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.gender, _this.gender) || other.gender == _this.gender)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.continent, _this.continent) || other.continent == _this.continent)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl)&&const DeepCollectionEquality().equals(other.tags, _this.tags));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as FaceModel;
  return Object.hash(runtimeType,_this.id,_this.gender,_this.label,_this.continent,_this.thumbnailUrl,const DeepCollectionEquality().hash(_this.tags));
}

@override
String toString() {
  final _this = this as FaceModel;
  return 'FaceModel(id: ${_this.id}, gender: ${_this.gender}, label: ${_this.label}, continent: ${_this.continent}, thumbnailUrl: ${_this.thumbnailUrl}, tags: ${_this.tags})';
}


}

/// @nodoc
abstract mixin class $FaceModelCopyWith<$Res>  {
  factory $FaceModelCopyWith(FaceModel value, $Res Function(FaceModel) _then) = _$FaceModelCopyWithImpl;
@useResult
$Res call({
 String id, String gender, String label, String? continent, String thumbnailUrl, List<String>? tags
});




}
/// @nodoc
class _$FaceModelCopyWithImpl<$Res>
    implements $FaceModelCopyWith<$Res> {
  _$FaceModelCopyWithImpl(this._self, this._then);

  final FaceModel _self;
  final $Res Function(FaceModel) _then;

/// Create a copy of FaceModel
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? gender = null,Object? label = null,Object? continent = freezed,Object? thumbnailUrl = null,Object? tags = freezed,}) {
  return _then(FaceModel(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,gender: null == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,continent: freezed == continent ? _self.continent : continent // ignore: cast_nullable_to_non_nullable
as String?,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,tags: freezed == tags ? _self.tags : tags // ignore: cast_nullable_to_non_nullable
as List<String>?,
  ));
}

}


/// Adds pattern-matching-related methods to [FaceModel].
extension FaceModelPatterns on FaceModel {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _FaceModel value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _FaceModel() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _FaceModel value)  $default,){
final _that = this;
switch (_that) {
case _FaceModel():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _FaceModel value)?  $default,){
final _that = this;
switch (_that) {
case _FaceModel() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String gender,  String label,  String? continent,  String thumbnailUrl,  List<String>? tags)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _FaceModel() when $default != null:
return $default(_that.id,_that.gender,_that.label,_that.continent,_that.thumbnailUrl,_that.tags);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String gender,  String label,  String? continent,  String thumbnailUrl,  List<String>? tags)  $default,) {final _that = this;
switch (_that) {
case _FaceModel():
return $default(_that.id,_that.gender,_that.label,_that.continent,_that.thumbnailUrl,_that.tags);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String gender,  String label,  String? continent,  String thumbnailUrl,  List<String>? tags)?  $default,) {final _that = this;
switch (_that) {
case _FaceModel() when $default != null:
return $default(_that.id,_that.gender,_that.label,_that.continent,_that.thumbnailUrl,_that.tags);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _FaceModel implements FaceModel {
  const _FaceModel({required this.id, required this.gender, required this.label, this.continent, required this.thumbnailUrl,  List<String>? tags}): _tags = tags;
  factory _FaceModel.fromJson(Map<String, dynamic> json) => _$FaceModelFromJson(json);

@override final  String id;
@override final  String gender;
@override final  String label;
@override final  String? continent;
@override final  String thumbnailUrl;
 final  List<String>? _tags;
@override List<String>? get tags {
  final value = _tags;
  if (value == null) return null;
  if (_tags is EqualUnmodifiableListView) return _tags;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(value);
}


/// Create a copy of FaceModel
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$FaceModelCopyWith<_FaceModel> get copyWith => __$FaceModelCopyWithImpl<_FaceModel>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$FaceModelToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _FaceModel&&(identical(other.id, id) || other.id == id)&&(identical(other.gender, gender) || other.gender == gender)&&(identical(other.label, label) || other.label == label)&&(identical(other.continent, continent) || other.continent == continent)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl)&&const DeepCollectionEquality().equals(other.tags, _tags));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,gender,label,continent,thumbnailUrl,const DeepCollectionEquality().hash(_tags));
}

@override
String toString() {
    return 'FaceModel(id: $id, gender: $gender, label: $label, continent: $continent, thumbnailUrl: $thumbnailUrl, tags: $tags)';
}


}

/// @nodoc
abstract mixin class _$FaceModelCopyWith<$Res> implements $FaceModelCopyWith<$Res> {
  factory _$FaceModelCopyWith(_FaceModel value, $Res Function(_FaceModel) _then) = __$FaceModelCopyWithImpl;
@override @useResult
$Res call({
 String id, String gender, String label, String? continent, String thumbnailUrl, List<String>? tags
});




}
/// @nodoc
class __$FaceModelCopyWithImpl<$Res>
    implements _$FaceModelCopyWith<$Res> {
  __$FaceModelCopyWithImpl(this._self, this._then);

  final _FaceModel _self;
  final $Res Function(_FaceModel) _then;

/// Create a copy of FaceModel
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? gender = null,Object? label = null,Object? continent = freezed,Object? thumbnailUrl = null,Object? tags = freezed,}) {
  return _then(_FaceModel(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,gender: null == gender ? _self.gender : gender // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,continent: freezed == continent ? _self.continent : continent // ignore: cast_nullable_to_non_nullable
as String?,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,tags: freezed == tags ? _self._tags : tags // ignore: cast_nullable_to_non_nullable
as List<String>?,
  ));
}


}

// dart format on
