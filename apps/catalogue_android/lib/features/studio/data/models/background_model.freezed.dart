// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'background_model.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$BackgroundModel {

 String get id; String get label; String get thumbnailUrl; String get previewUrl; bool get isWhiteBg; int? get categoryId; List<String>? get tags; String? get specialTag;
/// Create a copy of BackgroundModel
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$BackgroundModelCopyWith<BackgroundModel> get copyWith => _$BackgroundModelCopyWithImpl<BackgroundModel>(this as BackgroundModel, _$identity);

  /// Serializes this BackgroundModel to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as BackgroundModel;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is BackgroundModel&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl)&&(identical(other.previewUrl, _this.previewUrl) || other.previewUrl == _this.previewUrl)&&(identical(other.isWhiteBg, _this.isWhiteBg) || other.isWhiteBg == _this.isWhiteBg)&&(identical(other.categoryId, _this.categoryId) || other.categoryId == _this.categoryId)&&const DeepCollectionEquality().equals(other.tags, _this.tags)&&(identical(other.specialTag, _this.specialTag) || other.specialTag == _this.specialTag));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as BackgroundModel;
  return Object.hash(runtimeType,_this.id,_this.label,_this.thumbnailUrl,_this.previewUrl,_this.isWhiteBg,_this.categoryId,const DeepCollectionEquality().hash(_this.tags),_this.specialTag);
}

@override
String toString() {
  final _this = this as BackgroundModel;
  return 'BackgroundModel(id: ${_this.id}, label: ${_this.label}, thumbnailUrl: ${_this.thumbnailUrl}, previewUrl: ${_this.previewUrl}, isWhiteBg: ${_this.isWhiteBg}, categoryId: ${_this.categoryId}, tags: ${_this.tags}, specialTag: ${_this.specialTag})';
}


}

/// @nodoc
abstract mixin class $BackgroundModelCopyWith<$Res>  {
  factory $BackgroundModelCopyWith(BackgroundModel value, $Res Function(BackgroundModel) _then) = _$BackgroundModelCopyWithImpl;
@useResult
$Res call({
 String id, String label, String thumbnailUrl, String previewUrl, bool isWhiteBg, int? categoryId, List<String>? tags, String? specialTag
});




}
/// @nodoc
class _$BackgroundModelCopyWithImpl<$Res>
    implements $BackgroundModelCopyWith<$Res> {
  _$BackgroundModelCopyWithImpl(this._self, this._then);

  final BackgroundModel _self;
  final $Res Function(BackgroundModel) _then;

/// Create a copy of BackgroundModel
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? label = null,Object? thumbnailUrl = null,Object? previewUrl = null,Object? isWhiteBg = null,Object? categoryId = freezed,Object? tags = freezed,Object? specialTag = freezed,}) {
  return _then(BackgroundModel(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,previewUrl: null == previewUrl ? _self.previewUrl : previewUrl // ignore: cast_nullable_to_non_nullable
as String,isWhiteBg: null == isWhiteBg ? _self.isWhiteBg : isWhiteBg // ignore: cast_nullable_to_non_nullable
as bool,categoryId: freezed == categoryId ? _self.categoryId : categoryId // ignore: cast_nullable_to_non_nullable
as int?,tags: freezed == tags ? _self.tags : tags // ignore: cast_nullable_to_non_nullable
as List<String>?,specialTag: freezed == specialTag ? _self.specialTag : specialTag // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [BackgroundModel].
extension BackgroundModelPatterns on BackgroundModel {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _BackgroundModel value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _BackgroundModel() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _BackgroundModel value)  $default,){
final _that = this;
switch (_that) {
case _BackgroundModel():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _BackgroundModel value)?  $default,){
final _that = this;
switch (_that) {
case _BackgroundModel() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String label,  String thumbnailUrl,  String previewUrl,  bool isWhiteBg,  int? categoryId,  List<String>? tags,  String? specialTag)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _BackgroundModel() when $default != null:
return $default(_that.id,_that.label,_that.thumbnailUrl,_that.previewUrl,_that.isWhiteBg,_that.categoryId,_that.tags,_that.specialTag);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String label,  String thumbnailUrl,  String previewUrl,  bool isWhiteBg,  int? categoryId,  List<String>? tags,  String? specialTag)  $default,) {final _that = this;
switch (_that) {
case _BackgroundModel():
return $default(_that.id,_that.label,_that.thumbnailUrl,_that.previewUrl,_that.isWhiteBg,_that.categoryId,_that.tags,_that.specialTag);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String label,  String thumbnailUrl,  String previewUrl,  bool isWhiteBg,  int? categoryId,  List<String>? tags,  String? specialTag)?  $default,) {final _that = this;
switch (_that) {
case _BackgroundModel() when $default != null:
return $default(_that.id,_that.label,_that.thumbnailUrl,_that.previewUrl,_that.isWhiteBg,_that.categoryId,_that.tags,_that.specialTag);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _BackgroundModel implements BackgroundModel {
  const _BackgroundModel({required this.id, required this.label, required this.thumbnailUrl, required this.previewUrl, this.isWhiteBg = false, this.categoryId,  List<String>? tags, this.specialTag}): _tags = tags;
  factory _BackgroundModel.fromJson(Map<String, dynamic> json) => _$BackgroundModelFromJson(json);

@override final  String id;
@override final  String label;
@override final  String thumbnailUrl;
@override final  String previewUrl;
@override@JsonKey() final  bool isWhiteBg;
@override final  int? categoryId;
 final  List<String>? _tags;
@override List<String>? get tags {
  final value = _tags;
  if (value == null) return null;
  if (_tags is EqualUnmodifiableListView) return _tags;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(value);
}

@override final  String? specialTag;

/// Create a copy of BackgroundModel
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$BackgroundModelCopyWith<_BackgroundModel> get copyWith => __$BackgroundModelCopyWithImpl<_BackgroundModel>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$BackgroundModelToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _BackgroundModel&&(identical(other.id, id) || other.id == id)&&(identical(other.label, label) || other.label == label)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl)&&(identical(other.previewUrl, previewUrl) || other.previewUrl == previewUrl)&&(identical(other.isWhiteBg, isWhiteBg) || other.isWhiteBg == isWhiteBg)&&(identical(other.categoryId, categoryId) || other.categoryId == categoryId)&&const DeepCollectionEquality().equals(other.tags, _tags)&&(identical(other.specialTag, specialTag) || other.specialTag == specialTag));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,label,thumbnailUrl,previewUrl,isWhiteBg,categoryId,const DeepCollectionEquality().hash(_tags),specialTag);
}

@override
String toString() {
    return 'BackgroundModel(id: $id, label: $label, thumbnailUrl: $thumbnailUrl, previewUrl: $previewUrl, isWhiteBg: $isWhiteBg, categoryId: $categoryId, tags: $tags, specialTag: $specialTag)';
}


}

/// @nodoc
abstract mixin class _$BackgroundModelCopyWith<$Res> implements $BackgroundModelCopyWith<$Res> {
  factory _$BackgroundModelCopyWith(_BackgroundModel value, $Res Function(_BackgroundModel) _then) = __$BackgroundModelCopyWithImpl;
@override @useResult
$Res call({
 String id, String label, String thumbnailUrl, String previewUrl, bool isWhiteBg, int? categoryId, List<String>? tags, String? specialTag
});




}
/// @nodoc
class __$BackgroundModelCopyWithImpl<$Res>
    implements _$BackgroundModelCopyWith<$Res> {
  __$BackgroundModelCopyWithImpl(this._self, this._then);

  final _BackgroundModel _self;
  final $Res Function(_BackgroundModel) _then;

/// Create a copy of BackgroundModel
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? label = null,Object? thumbnailUrl = null,Object? previewUrl = null,Object? isWhiteBg = null,Object? categoryId = freezed,Object? tags = freezed,Object? specialTag = freezed,}) {
  return _then(_BackgroundModel(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,previewUrl: null == previewUrl ? _self.previewUrl : previewUrl // ignore: cast_nullable_to_non_nullable
as String,isWhiteBg: null == isWhiteBg ? _self.isWhiteBg : isWhiteBg // ignore: cast_nullable_to_non_nullable
as bool,categoryId: freezed == categoryId ? _self.categoryId : categoryId // ignore: cast_nullable_to_non_nullable
as int?,tags: freezed == tags ? _self._tags : tags // ignore: cast_nullable_to_non_nullable
as List<String>?,specialTag: freezed == specialTag ? _self.specialTag : specialTag // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
