// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'onboarding_prefill.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$OnboardingPrefill {

 String? get suggestedContactName; String? get suggestedCompanyName;
/// Create a copy of OnboardingPrefill
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$OnboardingPrefillCopyWith<OnboardingPrefill> get copyWith => _$OnboardingPrefillCopyWithImpl<OnboardingPrefill>(this as OnboardingPrefill, _$identity);

  /// Serializes this OnboardingPrefill to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as OnboardingPrefill;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is OnboardingPrefill&&(identical(other.suggestedContactName, _this.suggestedContactName) || other.suggestedContactName == _this.suggestedContactName)&&(identical(other.suggestedCompanyName, _this.suggestedCompanyName) || other.suggestedCompanyName == _this.suggestedCompanyName));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as OnboardingPrefill;
  return Object.hash(runtimeType,_this.suggestedContactName,_this.suggestedCompanyName);
}

@override
String toString() {
  final _this = this as OnboardingPrefill;
  return 'OnboardingPrefill(suggestedContactName: ${_this.suggestedContactName}, suggestedCompanyName: ${_this.suggestedCompanyName})';
}


}

/// @nodoc
abstract mixin class $OnboardingPrefillCopyWith<$Res>  {
  factory $OnboardingPrefillCopyWith(OnboardingPrefill value, $Res Function(OnboardingPrefill) _then) = _$OnboardingPrefillCopyWithImpl;
@useResult
$Res call({
 String? suggestedContactName, String? suggestedCompanyName
});




}
/// @nodoc
class _$OnboardingPrefillCopyWithImpl<$Res>
    implements $OnboardingPrefillCopyWith<$Res> {
  _$OnboardingPrefillCopyWithImpl(this._self, this._then);

  final OnboardingPrefill _self;
  final $Res Function(OnboardingPrefill) _then;

/// Create a copy of OnboardingPrefill
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? suggestedContactName = freezed,Object? suggestedCompanyName = freezed,}) {
  return _then(OnboardingPrefill(
suggestedContactName: freezed == suggestedContactName ? _self.suggestedContactName : suggestedContactName // ignore: cast_nullable_to_non_nullable
as String?,suggestedCompanyName: freezed == suggestedCompanyName ? _self.suggestedCompanyName : suggestedCompanyName // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [OnboardingPrefill].
extension OnboardingPrefillPatterns on OnboardingPrefill {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _OnboardingPrefill value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _OnboardingPrefill() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _OnboardingPrefill value)  $default,){
final _that = this;
switch (_that) {
case _OnboardingPrefill():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _OnboardingPrefill value)?  $default,){
final _that = this;
switch (_that) {
case _OnboardingPrefill() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String? suggestedContactName,  String? suggestedCompanyName)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _OnboardingPrefill() when $default != null:
return $default(_that.suggestedContactName,_that.suggestedCompanyName);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String? suggestedContactName,  String? suggestedCompanyName)  $default,) {final _that = this;
switch (_that) {
case _OnboardingPrefill():
return $default(_that.suggestedContactName,_that.suggestedCompanyName);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String? suggestedContactName,  String? suggestedCompanyName)?  $default,) {final _that = this;
switch (_that) {
case _OnboardingPrefill() when $default != null:
return $default(_that.suggestedContactName,_that.suggestedCompanyName);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _OnboardingPrefill implements OnboardingPrefill {
  const _OnboardingPrefill({this.suggestedContactName, this.suggestedCompanyName});
  factory _OnboardingPrefill.fromJson(Map<String, dynamic> json) => _$OnboardingPrefillFromJson(json);

@override final  String? suggestedContactName;
@override final  String? suggestedCompanyName;

/// Create a copy of OnboardingPrefill
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$OnboardingPrefillCopyWith<_OnboardingPrefill> get copyWith => __$OnboardingPrefillCopyWithImpl<_OnboardingPrefill>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$OnboardingPrefillToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _OnboardingPrefill&&(identical(other.suggestedContactName, suggestedContactName) || other.suggestedContactName == suggestedContactName)&&(identical(other.suggestedCompanyName, suggestedCompanyName) || other.suggestedCompanyName == suggestedCompanyName));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,suggestedContactName,suggestedCompanyName);
}

@override
String toString() {
    return 'OnboardingPrefill(suggestedContactName: $suggestedContactName, suggestedCompanyName: $suggestedCompanyName)';
}


}

/// @nodoc
abstract mixin class _$OnboardingPrefillCopyWith<$Res> implements $OnboardingPrefillCopyWith<$Res> {
  factory _$OnboardingPrefillCopyWith(_OnboardingPrefill value, $Res Function(_OnboardingPrefill) _then) = __$OnboardingPrefillCopyWithImpl;
@override @useResult
$Res call({
 String? suggestedContactName, String? suggestedCompanyName
});




}
/// @nodoc
class __$OnboardingPrefillCopyWithImpl<$Res>
    implements _$OnboardingPrefillCopyWith<$Res> {
  __$OnboardingPrefillCopyWithImpl(this._self, this._then);

  final _OnboardingPrefill _self;
  final $Res Function(_OnboardingPrefill) _then;

/// Create a copy of OnboardingPrefill
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? suggestedContactName = freezed,Object? suggestedCompanyName = freezed,}) {
  return _then(_OnboardingPrefill(
suggestedContactName: freezed == suggestedContactName ? _self.suggestedContactName : suggestedContactName // ignore: cast_nullable_to_non_nullable
as String?,suggestedCompanyName: freezed == suggestedCompanyName ? _self.suggestedCompanyName : suggestedCompanyName // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
