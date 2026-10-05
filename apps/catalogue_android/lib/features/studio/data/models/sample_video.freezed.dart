// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'sample_video.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$SampleVideo {

 String get id; String get title; String get prompt; String get thumbnailUrl; String get previewVideoUrl; int get duration; String get quality; int get creditCost;
/// Create a copy of SampleVideo
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$SampleVideoCopyWith<SampleVideo> get copyWith => _$SampleVideoCopyWithImpl<SampleVideo>(this as SampleVideo, _$identity);

  /// Serializes this SampleVideo to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as SampleVideo;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is SampleVideo&&(identical(other.id, _this.id) || other.id == _this.id)&&(identical(other.title, _this.title) || other.title == _this.title)&&(identical(other.prompt, _this.prompt) || other.prompt == _this.prompt)&&(identical(other.thumbnailUrl, _this.thumbnailUrl) || other.thumbnailUrl == _this.thumbnailUrl)&&(identical(other.previewVideoUrl, _this.previewVideoUrl) || other.previewVideoUrl == _this.previewVideoUrl)&&(identical(other.duration, _this.duration) || other.duration == _this.duration)&&(identical(other.quality, _this.quality) || other.quality == _this.quality)&&(identical(other.creditCost, _this.creditCost) || other.creditCost == _this.creditCost));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as SampleVideo;
  return Object.hash(runtimeType,_this.id,_this.title,_this.prompt,_this.thumbnailUrl,_this.previewVideoUrl,_this.duration,_this.quality,_this.creditCost);
}

@override
String toString() {
  final _this = this as SampleVideo;
  return 'SampleVideo(id: ${_this.id}, title: ${_this.title}, prompt: ${_this.prompt}, thumbnailUrl: ${_this.thumbnailUrl}, previewVideoUrl: ${_this.previewVideoUrl}, duration: ${_this.duration}, quality: ${_this.quality}, creditCost: ${_this.creditCost})';
}


}

/// @nodoc
abstract mixin class $SampleVideoCopyWith<$Res>  {
  factory $SampleVideoCopyWith(SampleVideo value, $Res Function(SampleVideo) _then) = _$SampleVideoCopyWithImpl;
@useResult
$Res call({
 String id, String title, String prompt, String thumbnailUrl, String previewVideoUrl, int duration, String quality, int creditCost
});




}
/// @nodoc
class _$SampleVideoCopyWithImpl<$Res>
    implements $SampleVideoCopyWith<$Res> {
  _$SampleVideoCopyWithImpl(this._self, this._then);

  final SampleVideo _self;
  final $Res Function(SampleVideo) _then;

/// Create a copy of SampleVideo
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? id = null,Object? title = null,Object? prompt = null,Object? thumbnailUrl = null,Object? previewVideoUrl = null,Object? duration = null,Object? quality = null,Object? creditCost = null,}) {
  return _then(SampleVideo(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,prompt: null == prompt ? _self.prompt : prompt // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,previewVideoUrl: null == previewVideoUrl ? _self.previewVideoUrl : previewVideoUrl // ignore: cast_nullable_to_non_nullable
as String,duration: null == duration ? _self.duration : duration // ignore: cast_nullable_to_non_nullable
as int,quality: null == quality ? _self.quality : quality // ignore: cast_nullable_to_non_nullable
as String,creditCost: null == creditCost ? _self.creditCost : creditCost // ignore: cast_nullable_to_non_nullable
as int,
  ));
}

}


/// Adds pattern-matching-related methods to [SampleVideo].
extension SampleVideoPatterns on SampleVideo {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _SampleVideo value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _SampleVideo() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _SampleVideo value)  $default,){
final _that = this;
switch (_that) {
case _SampleVideo():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _SampleVideo value)?  $default,){
final _that = this;
switch (_that) {
case _SampleVideo() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String id,  String title,  String prompt,  String thumbnailUrl,  String previewVideoUrl,  int duration,  String quality,  int creditCost)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _SampleVideo() when $default != null:
return $default(_that.id,_that.title,_that.prompt,_that.thumbnailUrl,_that.previewVideoUrl,_that.duration,_that.quality,_that.creditCost);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String id,  String title,  String prompt,  String thumbnailUrl,  String previewVideoUrl,  int duration,  String quality,  int creditCost)  $default,) {final _that = this;
switch (_that) {
case _SampleVideo():
return $default(_that.id,_that.title,_that.prompt,_that.thumbnailUrl,_that.previewVideoUrl,_that.duration,_that.quality,_that.creditCost);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String id,  String title,  String prompt,  String thumbnailUrl,  String previewVideoUrl,  int duration,  String quality,  int creditCost)?  $default,) {final _that = this;
switch (_that) {
case _SampleVideo() when $default != null:
return $default(_that.id,_that.title,_that.prompt,_that.thumbnailUrl,_that.previewVideoUrl,_that.duration,_that.quality,_that.creditCost);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _SampleVideo implements SampleVideo {
  const _SampleVideo({required this.id, required this.title, required this.prompt, required this.thumbnailUrl, required this.previewVideoUrl, required this.duration, required this.quality, required this.creditCost});
  factory _SampleVideo.fromJson(Map<String, dynamic> json) => _$SampleVideoFromJson(json);

@override final  String id;
@override final  String title;
@override final  String prompt;
@override final  String thumbnailUrl;
@override final  String previewVideoUrl;
@override final  int duration;
@override final  String quality;
@override final  int creditCost;

/// Create a copy of SampleVideo
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$SampleVideoCopyWith<_SampleVideo> get copyWith => __$SampleVideoCopyWithImpl<_SampleVideo>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$SampleVideoToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _SampleVideo&&(identical(other.id, id) || other.id == id)&&(identical(other.title, title) || other.title == title)&&(identical(other.prompt, prompt) || other.prompt == prompt)&&(identical(other.thumbnailUrl, thumbnailUrl) || other.thumbnailUrl == thumbnailUrl)&&(identical(other.previewVideoUrl, previewVideoUrl) || other.previewVideoUrl == previewVideoUrl)&&(identical(other.duration, duration) || other.duration == duration)&&(identical(other.quality, quality) || other.quality == quality)&&(identical(other.creditCost, creditCost) || other.creditCost == creditCost));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,id,title,prompt,thumbnailUrl,previewVideoUrl,duration,quality,creditCost);
}

@override
String toString() {
    return 'SampleVideo(id: $id, title: $title, prompt: $prompt, thumbnailUrl: $thumbnailUrl, previewVideoUrl: $previewVideoUrl, duration: $duration, quality: $quality, creditCost: $creditCost)';
}


}

/// @nodoc
abstract mixin class _$SampleVideoCopyWith<$Res> implements $SampleVideoCopyWith<$Res> {
  factory _$SampleVideoCopyWith(_SampleVideo value, $Res Function(_SampleVideo) _then) = __$SampleVideoCopyWithImpl;
@override @useResult
$Res call({
 String id, String title, String prompt, String thumbnailUrl, String previewVideoUrl, int duration, String quality, int creditCost
});




}
/// @nodoc
class __$SampleVideoCopyWithImpl<$Res>
    implements _$SampleVideoCopyWith<$Res> {
  __$SampleVideoCopyWithImpl(this._self, this._then);

  final _SampleVideo _self;
  final $Res Function(_SampleVideo) _then;

/// Create a copy of SampleVideo
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? id = null,Object? title = null,Object? prompt = null,Object? thumbnailUrl = null,Object? previewVideoUrl = null,Object? duration = null,Object? quality = null,Object? creditCost = null,}) {
  return _then(_SampleVideo(
id: null == id ? _self.id : id // ignore: cast_nullable_to_non_nullable
as String,title: null == title ? _self.title : title // ignore: cast_nullable_to_non_nullable
as String,prompt: null == prompt ? _self.prompt : prompt // ignore: cast_nullable_to_non_nullable
as String,thumbnailUrl: null == thumbnailUrl ? _self.thumbnailUrl : thumbnailUrl // ignore: cast_nullable_to_non_nullable
as String,previewVideoUrl: null == previewVideoUrl ? _self.previewVideoUrl : previewVideoUrl // ignore: cast_nullable_to_non_nullable
as String,duration: null == duration ? _self.duration : duration // ignore: cast_nullable_to_non_nullable
as int,quality: null == quality ? _self.quality : quality // ignore: cast_nullable_to_non_nullable
as String,creditCost: null == creditCost ? _self.creditCost : creditCost // ignore: cast_nullable_to_non_nullable
as int,
  ));
}


}


/// @nodoc
mixin _$PixversePricing {

@JsonKey(fromJson: _lenientNum) num get perSecondRate;@JsonKey(fromJson: _lenientNumMap) Map<String, num> get qualityBase;
/// Create a copy of PixversePricing
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$PixversePricingCopyWith<PixversePricing> get copyWith => _$PixversePricingCopyWithImpl<PixversePricing>(this as PixversePricing, _$identity);

  /// Serializes this PixversePricing to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as PixversePricing;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is PixversePricing&&(identical(other.perSecondRate, _this.perSecondRate) || other.perSecondRate == _this.perSecondRate)&&const DeepCollectionEquality().equals(other.qualityBase, _this.qualityBase));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as PixversePricing;
  return Object.hash(runtimeType,_this.perSecondRate,const DeepCollectionEquality().hash(_this.qualityBase));
}

@override
String toString() {
  final _this = this as PixversePricing;
  return 'PixversePricing(perSecondRate: ${_this.perSecondRate}, qualityBase: ${_this.qualityBase})';
}


}

/// @nodoc
abstract mixin class $PixversePricingCopyWith<$Res>  {
  factory $PixversePricingCopyWith(PixversePricing value, $Res Function(PixversePricing) _then) = _$PixversePricingCopyWithImpl;
@useResult
$Res call({
@JsonKey(fromJson: _lenientNum) num perSecondRate,@JsonKey(fromJson: _lenientNumMap) Map<String, num> qualityBase
});




}
/// @nodoc
class _$PixversePricingCopyWithImpl<$Res>
    implements $PixversePricingCopyWith<$Res> {
  _$PixversePricingCopyWithImpl(this._self, this._then);

  final PixversePricing _self;
  final $Res Function(PixversePricing) _then;

/// Create a copy of PixversePricing
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? perSecondRate = null,Object? qualityBase = null,}) {
  return _then(PixversePricing(
perSecondRate: null == perSecondRate ? _self.perSecondRate : perSecondRate // ignore: cast_nullable_to_non_nullable
as num,qualityBase: null == qualityBase ? _self.qualityBase : qualityBase // ignore: cast_nullable_to_non_nullable
as Map<String, num>,
  ));
}

}


/// Adds pattern-matching-related methods to [PixversePricing].
extension PixversePricingPatterns on PixversePricing {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _PixversePricing value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _PixversePricing() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _PixversePricing value)  $default,){
final _that = this;
switch (_that) {
case _PixversePricing():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _PixversePricing value)?  $default,){
final _that = this;
switch (_that) {
case _PixversePricing() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function(@JsonKey(fromJson: _lenientNum)  num perSecondRate, @JsonKey(fromJson: _lenientNumMap)  Map<String, num> qualityBase)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _PixversePricing() when $default != null:
return $default(_that.perSecondRate,_that.qualityBase);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function(@JsonKey(fromJson: _lenientNum)  num perSecondRate, @JsonKey(fromJson: _lenientNumMap)  Map<String, num> qualityBase)  $default,) {final _that = this;
switch (_that) {
case _PixversePricing():
return $default(_that.perSecondRate,_that.qualityBase);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function(@JsonKey(fromJson: _lenientNum)  num perSecondRate, @JsonKey(fromJson: _lenientNumMap)  Map<String, num> qualityBase)?  $default,) {final _that = this;
switch (_that) {
case _PixversePricing() when $default != null:
return $default(_that.perSecondRate,_that.qualityBase);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _PixversePricing implements PixversePricing {
  const _PixversePricing({@JsonKey(fromJson: _lenientNum) this.perSecondRate = 0, @JsonKey(fromJson: _lenientNumMap)  Map<String, num> qualityBase = const {}}): _qualityBase = qualityBase;
  factory _PixversePricing.fromJson(Map<String, dynamic> json) => _$PixversePricingFromJson(json);

@override@JsonKey(fromJson: _lenientNum) final  num perSecondRate;
 final  Map<String, num> _qualityBase;
@override@JsonKey(fromJson: _lenientNumMap) Map<String, num> get qualityBase {
  if (_qualityBase is EqualUnmodifiableMapView) return _qualityBase;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableMapView(_qualityBase);
}


/// Create a copy of PixversePricing
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$PixversePricingCopyWith<_PixversePricing> get copyWith => __$PixversePricingCopyWithImpl<_PixversePricing>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$PixversePricingToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _PixversePricing&&(identical(other.perSecondRate, perSecondRate) || other.perSecondRate == perSecondRate)&&const DeepCollectionEquality().equals(other.qualityBase, _qualityBase));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,perSecondRate,const DeepCollectionEquality().hash(_qualityBase));
}

@override
String toString() {
    return 'PixversePricing(perSecondRate: $perSecondRate, qualityBase: $qualityBase)';
}


}

/// @nodoc
abstract mixin class _$PixversePricingCopyWith<$Res> implements $PixversePricingCopyWith<$Res> {
  factory _$PixversePricingCopyWith(_PixversePricing value, $Res Function(_PixversePricing) _then) = __$PixversePricingCopyWithImpl;
@override @useResult
$Res call({
@JsonKey(fromJson: _lenientNum) num perSecondRate,@JsonKey(fromJson: _lenientNumMap) Map<String, num> qualityBase
});




}
/// @nodoc
class __$PixversePricingCopyWithImpl<$Res>
    implements _$PixversePricingCopyWith<$Res> {
  __$PixversePricingCopyWithImpl(this._self, this._then);

  final _PixversePricing _self;
  final $Res Function(_PixversePricing) _then;

/// Create a copy of PixversePricing
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? perSecondRate = null,Object? qualityBase = null,}) {
  return _then(_PixversePricing(
perSecondRate: null == perSecondRate ? _self.perSecondRate : perSecondRate // ignore: cast_nullable_to_non_nullable
as num,qualityBase: null == qualityBase ? _self._qualityBase : qualityBase // ignore: cast_nullable_to_non_nullable
as Map<String, num>,
  ));
}


}


/// @nodoc
mixin _$SampleVideosResponse {

 List<SampleVideo> get items; PixversePricing? get pixverseVideoPricing;
/// Create a copy of SampleVideosResponse
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$SampleVideosResponseCopyWith<SampleVideosResponse> get copyWith => _$SampleVideosResponseCopyWithImpl<SampleVideosResponse>(this as SampleVideosResponse, _$identity);

  /// Serializes this SampleVideosResponse to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as SampleVideosResponse;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is SampleVideosResponse&&const DeepCollectionEquality().equals(other.items, _this.items)&&(identical(other.pixverseVideoPricing, _this.pixverseVideoPricing) || other.pixverseVideoPricing == _this.pixverseVideoPricing));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as SampleVideosResponse;
  return Object.hash(runtimeType,const DeepCollectionEquality().hash(_this.items),_this.pixverseVideoPricing);
}

@override
String toString() {
  final _this = this as SampleVideosResponse;
  return 'SampleVideosResponse(items: ${_this.items}, pixverseVideoPricing: ${_this.pixverseVideoPricing})';
}


}

/// @nodoc
abstract mixin class $SampleVideosResponseCopyWith<$Res>  {
  factory $SampleVideosResponseCopyWith(SampleVideosResponse value, $Res Function(SampleVideosResponse) _then) = _$SampleVideosResponseCopyWithImpl;
@useResult
$Res call({
 List<SampleVideo> items, PixversePricing? pixverseVideoPricing
});


$PixversePricingCopyWith<$Res>? get pixverseVideoPricing;

}
/// @nodoc
class _$SampleVideosResponseCopyWithImpl<$Res>
    implements $SampleVideosResponseCopyWith<$Res> {
  _$SampleVideosResponseCopyWithImpl(this._self, this._then);

  final SampleVideosResponse _self;
  final $Res Function(SampleVideosResponse) _then;

/// Create a copy of SampleVideosResponse
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? items = null,Object? pixverseVideoPricing = freezed,}) {
  return _then(SampleVideosResponse(
items: null == items ? _self.items : items // ignore: cast_nullable_to_non_nullable
as List<SampleVideo>,pixverseVideoPricing: freezed == pixverseVideoPricing ? _self.pixverseVideoPricing : pixverseVideoPricing // ignore: cast_nullable_to_non_nullable
as PixversePricing?,
  ));
}
/// Create a copy of SampleVideosResponse
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$PixversePricingCopyWith<$Res>? get pixverseVideoPricing {
    if (_self.pixverseVideoPricing == null) {
    return null;
  }

  return $PixversePricingCopyWith<$Res>(_self.pixverseVideoPricing!, (value) {
    return _then(_self.copyWith(pixverseVideoPricing: value));
  });
}
}


/// Adds pattern-matching-related methods to [SampleVideosResponse].
extension SampleVideosResponsePatterns on SampleVideosResponse {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _SampleVideosResponse value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _SampleVideosResponse() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _SampleVideosResponse value)  $default,){
final _that = this;
switch (_that) {
case _SampleVideosResponse():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _SampleVideosResponse value)?  $default,){
final _that = this;
switch (_that) {
case _SampleVideosResponse() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( List<SampleVideo> items,  PixversePricing? pixverseVideoPricing)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _SampleVideosResponse() when $default != null:
return $default(_that.items,_that.pixverseVideoPricing);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( List<SampleVideo> items,  PixversePricing? pixverseVideoPricing)  $default,) {final _that = this;
switch (_that) {
case _SampleVideosResponse():
return $default(_that.items,_that.pixverseVideoPricing);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( List<SampleVideo> items,  PixversePricing? pixverseVideoPricing)?  $default,) {final _that = this;
switch (_that) {
case _SampleVideosResponse() when $default != null:
return $default(_that.items,_that.pixverseVideoPricing);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _SampleVideosResponse implements SampleVideosResponse {
  const _SampleVideosResponse({ List<SampleVideo> items = const [], this.pixverseVideoPricing}): _items = items;
  factory _SampleVideosResponse.fromJson(Map<String, dynamic> json) => _$SampleVideosResponseFromJson(json);

 final  List<SampleVideo> _items;
@override@JsonKey() List<SampleVideo> get items {
  if (_items is EqualUnmodifiableListView) return _items;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_items);
}

@override final  PixversePricing? pixverseVideoPricing;

/// Create a copy of SampleVideosResponse
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$SampleVideosResponseCopyWith<_SampleVideosResponse> get copyWith => __$SampleVideosResponseCopyWithImpl<_SampleVideosResponse>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$SampleVideosResponseToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _SampleVideosResponse&&const DeepCollectionEquality().equals(other.items, _items)&&(identical(other.pixverseVideoPricing, pixverseVideoPricing) || other.pixverseVideoPricing == pixverseVideoPricing));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,const DeepCollectionEquality().hash(_items),pixverseVideoPricing);
}

@override
String toString() {
    return 'SampleVideosResponse(items: $items, pixverseVideoPricing: $pixverseVideoPricing)';
}


}

/// @nodoc
abstract mixin class _$SampleVideosResponseCopyWith<$Res> implements $SampleVideosResponseCopyWith<$Res> {
  factory _$SampleVideosResponseCopyWith(_SampleVideosResponse value, $Res Function(_SampleVideosResponse) _then) = __$SampleVideosResponseCopyWithImpl;
@override @useResult
$Res call({
 List<SampleVideo> items, PixversePricing? pixverseVideoPricing
});


@override $PixversePricingCopyWith<$Res>? get pixverseVideoPricing;

}
/// @nodoc
class __$SampleVideosResponseCopyWithImpl<$Res>
    implements _$SampleVideosResponseCopyWith<$Res> {
  __$SampleVideosResponseCopyWithImpl(this._self, this._then);

  final _SampleVideosResponse _self;
  final $Res Function(_SampleVideosResponse) _then;

/// Create a copy of SampleVideosResponse
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? items = null,Object? pixverseVideoPricing = freezed,}) {
  return _then(_SampleVideosResponse(
items: null == items ? _self._items : items // ignore: cast_nullable_to_non_nullable
as List<SampleVideo>,pixverseVideoPricing: freezed == pixverseVideoPricing ? _self.pixverseVideoPricing : pixverseVideoPricing // ignore: cast_nullable_to_non_nullable
as PixversePricing?,
  ));
}

/// Create a copy of SampleVideosResponse
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$PixversePricingCopyWith<$Res>? get pixverseVideoPricing {
    if (_self.pixverseVideoPricing == null) {
    return null;
  }

  return $PixversePricingCopyWith<$Res>(_self.pixverseVideoPricing!, (value) {
    return _then(_self.copyWith(pixverseVideoPricing: value));
  });
}
}

// dart format on
