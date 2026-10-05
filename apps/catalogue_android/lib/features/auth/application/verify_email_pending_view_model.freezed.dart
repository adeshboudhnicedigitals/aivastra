// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'verify_email_pending_view_model.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$VerifyEmailPendingState {

 bool get isSending; bool get justSent; String? get errorMessage;
/// Create a copy of VerifyEmailPendingState
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$VerifyEmailPendingStateCopyWith<VerifyEmailPendingState> get copyWith => _$VerifyEmailPendingStateCopyWithImpl<VerifyEmailPendingState>(this as VerifyEmailPendingState, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as VerifyEmailPendingState;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is VerifyEmailPendingState&&(identical(other.isSending, _this.isSending) || other.isSending == _this.isSending)&&(identical(other.justSent, _this.justSent) || other.justSent == _this.justSent)&&(identical(other.errorMessage, _this.errorMessage) || other.errorMessage == _this.errorMessage));
}


@override
int get hashCode {
  final _this = this as VerifyEmailPendingState;
  return Object.hash(runtimeType,_this.isSending,_this.justSent,_this.errorMessage);
}

@override
String toString() {
  final _this = this as VerifyEmailPendingState;
  return 'VerifyEmailPendingState(isSending: ${_this.isSending}, justSent: ${_this.justSent}, errorMessage: ${_this.errorMessage})';
}


}

/// @nodoc
abstract mixin class $VerifyEmailPendingStateCopyWith<$Res>  {
  factory $VerifyEmailPendingStateCopyWith(VerifyEmailPendingState value, $Res Function(VerifyEmailPendingState) _then) = _$VerifyEmailPendingStateCopyWithImpl;
@useResult
$Res call({
 bool isSending, bool justSent, String? errorMessage
});




}
/// @nodoc
class _$VerifyEmailPendingStateCopyWithImpl<$Res>
    implements $VerifyEmailPendingStateCopyWith<$Res> {
  _$VerifyEmailPendingStateCopyWithImpl(this._self, this._then);

  final VerifyEmailPendingState _self;
  final $Res Function(VerifyEmailPendingState) _then;

/// Create a copy of VerifyEmailPendingState
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? isSending = null,Object? justSent = null,Object? errorMessage = freezed,}) {
  return _then(VerifyEmailPendingState(
isSending: null == isSending ? _self.isSending : isSending // ignore: cast_nullable_to_non_nullable
as bool,justSent: null == justSent ? _self.justSent : justSent // ignore: cast_nullable_to_non_nullable
as bool,errorMessage: freezed == errorMessage ? _self.errorMessage : errorMessage // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}

}


/// Adds pattern-matching-related methods to [VerifyEmailPendingState].
extension VerifyEmailPendingStatePatterns on VerifyEmailPendingState {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _VerifyEmailPendingState value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _VerifyEmailPendingState() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _VerifyEmailPendingState value)  $default,){
final _that = this;
switch (_that) {
case _VerifyEmailPendingState():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _VerifyEmailPendingState value)?  $default,){
final _that = this;
switch (_that) {
case _VerifyEmailPendingState() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( bool isSending,  bool justSent,  String? errorMessage)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _VerifyEmailPendingState() when $default != null:
return $default(_that.isSending,_that.justSent,_that.errorMessage);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( bool isSending,  bool justSent,  String? errorMessage)  $default,) {final _that = this;
switch (_that) {
case _VerifyEmailPendingState():
return $default(_that.isSending,_that.justSent,_that.errorMessage);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( bool isSending,  bool justSent,  String? errorMessage)?  $default,) {final _that = this;
switch (_that) {
case _VerifyEmailPendingState() when $default != null:
return $default(_that.isSending,_that.justSent,_that.errorMessage);case _:
  return null;

}
}

}

/// @nodoc


class _VerifyEmailPendingState implements VerifyEmailPendingState {
  const _VerifyEmailPendingState({this.isSending = false, this.justSent = false, this.errorMessage});
  

@override@JsonKey() final  bool isSending;
@override@JsonKey() final  bool justSent;
@override final  String? errorMessage;

/// Create a copy of VerifyEmailPendingState
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$VerifyEmailPendingStateCopyWith<_VerifyEmailPendingState> get copyWith => __$VerifyEmailPendingStateCopyWithImpl<_VerifyEmailPendingState>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _VerifyEmailPendingState&&(identical(other.isSending, isSending) || other.isSending == isSending)&&(identical(other.justSent, justSent) || other.justSent == justSent)&&(identical(other.errorMessage, errorMessage) || other.errorMessage == errorMessage));
}


@override
int get hashCode {
    return Object.hash(runtimeType,isSending,justSent,errorMessage);
}

@override
String toString() {
    return 'VerifyEmailPendingState(isSending: $isSending, justSent: $justSent, errorMessage: $errorMessage)';
}


}

/// @nodoc
abstract mixin class _$VerifyEmailPendingStateCopyWith<$Res> implements $VerifyEmailPendingStateCopyWith<$Res> {
  factory _$VerifyEmailPendingStateCopyWith(_VerifyEmailPendingState value, $Res Function(_VerifyEmailPendingState) _then) = __$VerifyEmailPendingStateCopyWithImpl;
@override @useResult
$Res call({
 bool isSending, bool justSent, String? errorMessage
});




}
/// @nodoc
class __$VerifyEmailPendingStateCopyWithImpl<$Res>
    implements _$VerifyEmailPendingStateCopyWith<$Res> {
  __$VerifyEmailPendingStateCopyWithImpl(this._self, this._then);

  final _VerifyEmailPendingState _self;
  final $Res Function(_VerifyEmailPendingState) _then;

/// Create a copy of VerifyEmailPendingState
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? isSending = null,Object? justSent = null,Object? errorMessage = freezed,}) {
  return _then(_VerifyEmailPendingState(
isSending: null == isSending ? _self.isSending : isSending // ignore: cast_nullable_to_non_nullable
as bool,justSent: null == justSent ? _self.justSent : justSent // ignore: cast_nullable_to_non_nullable
as bool,errorMessage: freezed == errorMessage ? _self.errorMessage : errorMessage // ignore: cast_nullable_to_non_nullable
as String?,
  ));
}


}

// dart format on
