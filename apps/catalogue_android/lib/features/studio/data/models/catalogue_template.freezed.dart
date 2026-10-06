// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'catalogue_template.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$TemplateLook {

 String get id; String get poseId; String get poseLabel; String get poseThumbnailUrl; String get backgroundId; String get backgroundLabel; String get backgroundThumbnailUrl; bool get hasLower; bool get hasShoes;
/// Create a copy of TemplateLook
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$TemplateLookCopyWith<TemplateLook> get copyWith => _$TemplateLookCopyWithImpl<TemplateLook>(this as TemplateLook, _$identity);

  /// Serializes this TemplateLook to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as TemplateLook;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is TemplateLook&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.poseId, _this.poseId) || other.poseId == _this.poseId)&&(identical(other.poseLabel, _this.poseLabel) || other.poseLabel == _this.poseLabel)&&(identical(other.poseThumbnailUrl, _this.poseThumbnailUrl) || other.poseThumbnailUrl == _this.poseThumbnailUrl)&&(identical(other.backgroundId, _this.backgroundId) || other.backgroundId == _this.backgroundId)&&(identical(other.backgroundLabel, _this.backgroundLabel) || other.backgroundLabel == _this.backgroundLabel)&&(identical(other.backgroundThumbnailUrl, _this.backgroundThumbnailUrl) || other.backgroundThumbnailUrl == _this.backgroundThumbnailUrl)&&(identical(other.hasLower, _this.hasLower) || other.hasLower == _this.hasLower)&&(identical(other.hasShoes, _this.hasShoes) || other.hasShoes == _this.hasShoes));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as TemplateLook;
  return Object.hash(runtimeType,_this.id,_this.poseId,_this.poseLabel,_this.poseThumbnailUrl,_this.backgroundId,_this.backgroundLabel,_this.backgroundThumbnailUrl,_this.hasLower,_this.hasShoes);
}

@override
String toString() {
  final _this = this as TemplateLook;
  return 'TemplateLook(id: ${_this.id}, poseId: ${_this.poseId}, poseLabel: ${_this.poseLabel}, poseThumbnailUrl: ${_this.poseThumbnailUrl}, backgroundId: ${_this.backgroundId}, backgroundLabel: ${_this.backgroundLabel}, backgroundThumbnailUrl: ${_this.backgroundThumbnailUrl}, hasLower: ${_this.hasLower}, hasShoes: ${_this.hasShoes})';
}


}

/// @nodoc
abstract mixin class $TemplateLookCopyWith<$Res>  {
  factory $TemplateLookCopyWith(TemplateLook value, $Res Function(TemplateLook) _then) = _$TemplateLookCopyWithImpl;
@useResult
$Res call({
 String id, String poseId, String poseLabel, String poseThumbnailUrl, String backgroundId, String backgroundLabel, String backgroundThumbnailUrl, bool hasLower, bool hasShoes
});




}
/// @nodoc
class _$TemplateLookCopyWithImpl<$Res>
    implements $TemplateLookCopyWith<$Res> {
  _$TemplateLookCopyWithImpl(this._self, this._then);

  final TemplateLook _self;
  final $Res Function(TemplateLook) _then;

/// Create a copy of TemplateLook
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? poseId = null,Object? poseLabel = null,Object? poseThumbnailUrl = null,Object? backgroundId = null,Object? backgroundLabel = null,Object? backgroundThumbnailUrl = null,Object? hasLower = null,Object? hasShoes = null,}) {
  return _then(TemplateLook(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,poseId: null == poseId ? _self.poseId : poseId // ignore: cast_nullable_to_non_nullable
as String,poseLabel: null == poseLabel ? _self.poseLabel : poseLabel // ignore: cast_nullable_to_non_nullable
as String,poseThumbnailUrl: null == poseThumbnailUrl ? _self.poseThumbnailUrl : poseThumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,backgroundId: null == backgroundId ? _self.backgroundId : backgroundId // ignore: cast_nullable_to_non_nullable
as String,backgroundLabel: null == backgroundLabel ? _self.backgroundLabel : backgroundLabel // ignore: cast_nullable_to_non_nullable
as String,backgroundThumbnailUrl: null == backgroundThumbnailUrl ? _self.backgroundThumbnailUrl : backgroundThumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,hasLower: null == hasLower ? _self.hasLower : hasLower // ignore: cast_nullable_to_non_nullable
as bool,hasShoes: null == hasShoes ? _self.hasShoes : hasShoes // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}

}


/// Adds pattern-matching-related methods to [TemplateLook].
extension TemplateLookPatterns on TemplateLook {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _TemplateLook value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _TemplateLook() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _TemplateLook value)  $default,){
final _that = this;
switch (_that) {
case _TemplateLook():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _TemplateLook value)?  $default,){
final _that = this;
switch (_that) {
case _TemplateLook() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String poseId,  String poseLabel,  String poseThumbnailUrl,  String backgroundId,  String backgroundLabel,  String backgroundThumbnailUrl,  bool hasLower,  bool hasShoes)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _TemplateLook() when $default != null:
return $default(_that.id,_that.poseId,_that.poseLabel,_that.poseThumbnailUrl,_that.backgroundId,_that.backgroundLabel,_that.backgroundThumbnailUrl,_that.hasLower,_that.hasShoes);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String poseId,  String poseLabel,  String poseThumbnailUrl,  String backgroundId,  String backgroundLabel,  String backgroundThumbnailUrl,  bool hasLower,  bool hasShoes)  $default,) {final _that = this;
switch (_that) {
case _TemplateLook():
return $default(_that.id,_that.poseId,_that.poseLabel,_that.poseThumbnailUrl,_that.backgroundId,_that.backgroundLabel,_that.backgroundThumbnailUrl,_that.hasLower,_that.hasShoes);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String poseId,  String poseLabel,  String poseThumbnailUrl,  String backgroundId,  String backgroundLabel,  String backgroundThumbnailUrl,  bool hasLower,  bool hasShoes)?  $default,) {final _that = this;
switch (_that) {
case _TemplateLook() when $default != null:
return $default(_that.id,_that.poseId,_that.poseLabel,_that.poseThumbnailUrl,_that.backgroundId,_that.backgroundLabel,_that.backgroundThumbnailUrl,_that.hasLower,_that.hasShoes);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _TemplateLook implements TemplateLook {
  const _TemplateLook({required this.id, required this.poseId, required this.poseLabel, required this.poseThumbnailUrl, required this.backgroundId, required this.backgroundLabel, required this.backgroundThumbnailUrl, this.hasLower = false, this.hasShoes = false});
  factory _TemplateLook.fromJson(Map<String, dynamic> json) => _$TemplateLookFromJson(json);

@override final  String id;
@override final  String poseId;
@override final  String poseLabel;
@override final  String poseThumbnailUrl;
@override final  String backgroundId;
@override final  String backgroundLabel;
@override final  String backgroundThumbnailUrl;
@override@JsonKey() final  bool hasLower;
@override@JsonKey() final  bool hasShoes;

/// Create a copy of TemplateLook
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$TemplateLookCopyWith<_TemplateLook> get copyWith => __$TemplateLookCopyWithImpl<_TemplateLook>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$TemplateLookToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _TemplateLook&&(identical(other.id, id) || other.id == id)&&(identical(other.poseId, poseId) || other.poseId == poseId)&&(identical(other.poseLabel, poseLabel) || other.poseLabel == poseLabel)&&(identical(other.poseThumbnailUrl, poseThumbnailUrl) || other.poseThumbnailUrl == poseThumbnailUrl)&&(identical(other.backgroundId, backgroundId) || other.backgroundId == backgroundId)&&(identical(other.backgroundLabel, backgroundLabel) || other.backgroundLabel == backgroundLabel)&&(identical(other.backgroundThumbnailUrl, backgroundThumbnailUrl) || other.backgroundThumbnailUrl == backgroundThumbnailUrl)&&(identical(other.hasLower, hasLower) || other.hasLower == hasLower)&&(identical(other.hasShoes, hasShoes) || other.hasShoes == hasShoes));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,poseId,poseLabel,poseThumbnailUrl,backgroundId,backgroundLabel,backgroundThumbnailUrl,hasLower,hasShoes);
}

@override
String toString() {
    return 'TemplateLook(id: $id, poseId: $poseId, poseLabel: $poseLabel, poseThumbnailUrl: $poseThumbnailUrl, backgroundId: $backgroundId, backgroundLabel: $backgroundLabel, backgroundThumbnailUrl: $backgroundThumbnailUrl, hasLower: $hasLower, hasShoes: $hasShoes)';
}


}

/// @nodoc
abstract mixin class _$TemplateLookCopyWith<$Res> implements $TemplateLookCopyWith<$Res> {
  factory _$TemplateLookCopyWith(_TemplateLook value, $Res Function(_TemplateLook) _then) = __$TemplateLookCopyWithImpl;
@override @useResult
$Res call({
 String id, String poseId, String poseLabel, String poseThumbnailUrl, String backgroundId, String backgroundLabel, String backgroundThumbnailUrl, bool hasLower, bool hasShoes
});




}
/// @nodoc
class __$TemplateLookCopyWithImpl<$Res>
    implements _$TemplateLookCopyWith<$Res> {
  __$TemplateLookCopyWithImpl(this._self, this._then);

  final _TemplateLook _self;
  final $Res Function(_TemplateLook) _then;

/// Create a copy of TemplateLook
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? poseId = null,Object? poseLabel = null,Object? poseThumbnailUrl = null,Object? backgroundId = null,Object? backgroundLabel = null,Object? backgroundThumbnailUrl = null,Object? hasLower = null,Object? hasShoes = null,}) {
  return _then(_TemplateLook(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,poseId: null == poseId ? _self.poseId : poseId // ignore: cast_nullable_to_non_nullable
as String,poseLabel: null == poseLabel ? _self.poseLabel : poseLabel // ignore: cast_nullable_to_non_nullable
as String,poseThumbnailUrl: null == poseThumbnailUrl ? _self.poseThumbnailUrl : poseThumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,backgroundId: null == backgroundId ? _self.backgroundId : backgroundId // ignore: cast_nullable_to_non_nullable
as String,backgroundLabel: null == backgroundLabel ? _self.backgroundLabel : backgroundLabel // ignore: cast_nullable_to_non_nullable
as String,backgroundThumbnailUrl: null == backgroundThumbnailUrl ? _self.backgroundThumbnailUrl : backgroundThumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,hasLower: null == hasLower ? _self.hasLower : hasLower // ignore: cast_nullable_to_non_nullable
as bool,hasShoes: null == hasShoes ? _self.hasShoes : hasShoes // ignore: cast_nullable_to_non_nullable
as bool,
  ));
}


}


/// @nodoc
mixin _$CatalogueTemplate {

 String get id; String get mappingId; String get label; String? get thumbnailUrl; List<TemplateLook> get looks;
/// Create a copy of CatalogueTemplate
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$CatalogueTemplateCopyWith<CatalogueTemplate> get copyWith => _$CatalogueTemplateCopyWithImpl<CatalogueTemplate>(this as CatalogueTemplate, _$identity);

  /// Serializes this CatalogueTemplate to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as CatalogueTemplate;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is CatalogueTemplate&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.mappingId, _this.mappingId) || other.mappingId == _this.mappingId)&&(identical(other.label, _this.label) || other.label == _this.label)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl)&&const DeepCollectionEquality().equals(other.looks, _this.looks));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as CatalogueTemplate;
  return Object.hash(runtimeType,_this.id,_this.mappingId,_this.label,_this.thumbnailUrl,const DeepCollectionEquality().hash(_this.looks));
}

@override
String toString() {
  final _this = this as CatalogueTemplate;
  return 'CatalogueTemplate(id: ${_this.id}, mappingId: ${_this.mappingId}, label: ${_this.label}, thumbnailUrl: ${_this.thumbnailUrl}, looks: ${_this.looks})';
}


}

/// @nodoc
abstract mixin class $CatalogueTemplateCopyWith<$Res>  {
  factory $CatalogueTemplateCopyWith(CatalogueTemplate value, $Res Function(CatalogueTemplate) _then) = _$CatalogueTemplateCopyWithImpl;
@useResult
$Res call({
 String id, String mappingId, String label, String? thumbnailUrl, List<TemplateLook> looks
});




}
/// @nodoc
class _$CatalogueTemplateCopyWithImpl<$Res>
    implements $CatalogueTemplateCopyWith<$Res> {
  _$CatalogueTemplateCopyWithImpl(this._self, this._then);

  final CatalogueTemplate _self;
  final $Res Function(CatalogueTemplate) _then;

/// Create a copy of CatalogueTemplate
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? mappingId = null,Object? label = null,Object? thumbnailUrl = freezed,Object? looks = null,}) {
  return _then(CatalogueTemplate(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,mappingId: null == mappingId ? _self.mappingId : mappingId // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,looks: null == looks ? _self.looks : looks // ignore: cast_nullable_to_non_nullable
as List<TemplateLook>,
  ));
}

}


/// Adds pattern-matching-related methods to [CatalogueTemplate].
extension CatalogueTemplatePatterns on CatalogueTemplate {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _CatalogueTemplate value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _CatalogueTemplate() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _CatalogueTemplate value)  $default,){
final _that = this;
switch (_that) {
case _CatalogueTemplate():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _CatalogueTemplate value)?  $default,){
final _that = this;
switch (_that) {
case _CatalogueTemplate() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String mappingId,  String label,  String? thumbnailUrl,  List<TemplateLook> looks)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _CatalogueTemplate() when $default != null:
return $default(_that.id,_that.mappingId,_that.label,_that.thumbnailUrl,_that.looks);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String mappingId,  String label,  String? thumbnailUrl,  List<TemplateLook> looks)  $default,) {final _that = this;
switch (_that) {
case _CatalogueTemplate():
return $default(_that.id,_that.mappingId,_that.label,_that.thumbnailUrl,_that.looks);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String mappingId,  String label,  String? thumbnailUrl,  List<TemplateLook> looks)?  $default,) {final _that = this;
switch (_that) {
case _CatalogueTemplate() when $default != null:
return $default(_that.id,_that.mappingId,_that.label,_that.thumbnailUrl,_that.looks);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _CatalogueTemplate implements CatalogueTemplate {
  const _CatalogueTemplate({required this.id, required this.mappingId, required this.label, this.thumbnailUrl, required  List<TemplateLook> looks}): _looks = looks;
  factory _CatalogueTemplate.fromJson(Map<String, dynamic> json) => _$CatalogueTemplateFromJson(json);

@override final  String id;
@override final  String mappingId;
@override final  String label;
@override final  String? thumbnailUrl;
 final  List<TemplateLook> _looks;
@override List<TemplateLook> get looks {
  if (_looks is EqualUnmodifiableListView) return _looks;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_looks);
}


/// Create a copy of CatalogueTemplate
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$CatalogueTemplateCopyWith<_CatalogueTemplate> get copyWith => __$CatalogueTemplateCopyWithImpl<_CatalogueTemplate>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$CatalogueTemplateToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _CatalogueTemplate&&(identical(other.id, id) || other.id == id)&&(identical(other.mappingId, mappingId) || other.mappingId == mappingId)&&(identical(other.label, label) || other.label == label)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl)&&const DeepCollectionEquality().equals(other.looks, _looks));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,mappingId,label,thumbnailUrl,const DeepCollectionEquality().hash(_looks));
}

@override
String toString() {
    return 'CatalogueTemplate(id: $id, mappingId: $mappingId, label: $label, thumbnailUrl: $thumbnailUrl, looks: $looks)';
}


}

/// @nodoc
abstract mixin class _$CatalogueTemplateCopyWith<$Res> implements $CatalogueTemplateCopyWith<$Res> {
  factory _$CatalogueTemplateCopyWith(_CatalogueTemplate value, $Res Function(_CatalogueTemplate) _then) = __$CatalogueTemplateCopyWithImpl;
@override @useResult
$Res call({
 String id, String mappingId, String label, String? thumbnailUrl, List<TemplateLook> looks
});




}
/// @nodoc
class __$CatalogueTemplateCopyWithImpl<$Res>
    implements _$CatalogueTemplateCopyWith<$Res> {
  __$CatalogueTemplateCopyWithImpl(this._self, this._then);

  final _CatalogueTemplate _self;
  final $Res Function(_CatalogueTemplate) _then;

/// Create a copy of CatalogueTemplate
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? mappingId = null,Object? label = null,Object? thumbnailUrl = freezed,Object? looks = null,}) {
  return _then(_CatalogueTemplate(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,mappingId: null == mappingId ? _self.mappingId : mappingId // ignore: cast_nullable_to_non_nullable
as String,label: null == label ? _self.label : label // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: freezed == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String?,looks: null == looks ? _self._looks : looks // ignore: cast_nullable_to_non_nullable
as List<TemplateLook>,
  ));
}


}

// dart format on
