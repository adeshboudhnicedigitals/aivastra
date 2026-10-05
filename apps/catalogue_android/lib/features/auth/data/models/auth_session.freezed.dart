// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'auth_session.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;

/// @nodoc
mixin _$AuthSession {

 String get accessToken; String get refreshToken; AppUser get user; String? get logoUrl; String? get loadingVideoUrl; String get merchantStatus; OnboardingPrefill? get onboarding;
/// Create a copy of AuthSession
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AuthSessionCopyWith<AuthSession> get copyWith => _$AuthSessionCopyWithImpl<AuthSession>(this as AuthSession, _$identity);

  /// Serializes this AuthSession to a JSON map.
  Map<String, dynamic> toJson();


@override
bool operator ==(Object other) {
  final _this = this as AuthSession;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is AuthSession&&(identical(other.accessToken, _this.accessToken) || other.accessToken == _this.accessToken)&&(identical(other.refreshToken, _this.refreshToken) || other.refreshToken == _this.refreshToken)&&(identical(other.user, _this.user) || other.user == _this.user)&&(identical(other.logoUrl, _this.logoUrl) || other.logoUrl == _this.logoUrl)&&(identical(other.loadingVideoUrl, _this.loadingVideoUrl) || other.loadingVideoUrl == _this.loadingVideoUrl)&&(identical(other.merchantStatus, _this.merchantStatus) || other.merchantStatus == _this.merchantStatus)&&(identical(other.onboarding, _this.onboarding) || other.onboarding == _this.onboarding));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
  final _this = this as AuthSession;
  return Object.hash(runtimeType,_this.accessToken,_this.refreshToken,_this.user,_this.logoUrl,_this.loadingVideoUrl,_this.merchantStatus,_this.onboarding);
}

@override
String toString() {
  final _this = this as AuthSession;
  return 'AuthSession(accessToken: ${_this.accessToken}, refreshToken: ${_this.refreshToken}, user: ${_this.user}, logoUrl: ${_this.logoUrl}, loadingVideoUrl: ${_this.loadingVideoUrl}, merchantStatus: ${_this.merchantStatus}, onboarding: ${_this.onboarding})';
}


}

/// @nodoc
abstract mixin class $AuthSessionCopyWith<$Res>  {
  factory $AuthSessionCopyWith(AuthSession value, $Res Function(AuthSession) _then) = _$AuthSessionCopyWithImpl;
@useResult
$Res call({
 String accessToken, String refreshToken, AppUser user, String? logoUrl, String? loadingVideoUrl, String merchantStatus, OnboardingPrefill? onboarding
});


$AppUserCopyWith<$Res> get user;$OnboardingPrefillCopyWith<$Res>? get onboarding;

}
/// @nodoc
class _$AuthSessionCopyWithImpl<$Res>
    implements $AuthSessionCopyWith<$Res> {
  _$AuthSessionCopyWithImpl(this._self, this._then);

  final AuthSession _self;
  final $Res Function(AuthSession) _then;

/// Create a copy of AuthSession
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? accessToken = null,Object? refreshToken = null,Object? user = null,Object? logoUrl = freezed,Object? loadingVideoUrl = freezed,Object? merchantStatus = null,Object? onboarding = freezed,}) {
  return _then(AuthSession(
accessToken: null == accessToken ? _self.accessToken : accessToken // ignore: cast_nullable_to_non_nullable
as String,refreshToken: null == refreshToken ? _self.refreshToken : refreshToken // ignore: cast_nullable_to_non_nullable
as String,user: null == user ? _self.user : user // ignore: cast_nullable_to_non_nullable
as AppUser,logoUrl: freezed == logoUrl ? _self.logoUrl : logoUrl // ignore: cast_nullable_to_non_nullable
as String?,loadingVideoUrl: freezed == loadingVideoUrl ? _self.loadingVideoUrl : loadingVideoUrl // ignore: cast_nullable_to_non_nullable
as String?,merchantStatus: null == merchantStatus ? _self.merchantStatus : merchantStatus // ignore: cast_nullable_to_non_nullable
as String,onboarding: freezed == onboarding ? _self.onboarding : onboarding // ignore: cast_nullable_to_non_nullable
as OnboardingPrefill?,
  ));
}
/// Create a copy of AuthSession
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$AppUserCopyWith<$Res> get user {
  
  return $AppUserCopyWith<$Res>(_self.user, (value) {
    return _then(_self.copyWith(user: value));
  });
}/// Create a copy of AuthSession
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$OnboardingPrefillCopyWith<$Res>? get onboarding {
    if (_self.onboarding == null) {
    return null;
  }

  return $OnboardingPrefillCopyWith<$Res>(_self.onboarding!, (value) {
    return _then(_self.copyWith(onboarding: value));
  });
}
}


/// Adds pattern-matching-related methods to [AuthSession].
extension AuthSessionPatterns on AuthSession {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>(TResult Function( _AuthSession value)?  $default,{required TResult orElse(),}){
final _that = this;
switch (_that) {
case _AuthSession() when $default != null:
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

@optionalTypeArgs TResult map<TResult extends Object?>(TResult Function( _AuthSession value)  $default,){
final _that = this;
switch (_that) {
case _AuthSession():
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>(TResult? Function( _AuthSession value)?  $default,){
final _that = this;
switch (_that) {
case _AuthSession() when $default != null:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>(TResult Function( String accessToken,  String refreshToken,  AppUser user,  String? logoUrl,  String? loadingVideoUrl,  String merchantStatus,  OnboardingPrefill? onboarding)?  $default,{required TResult orElse(),}) {final _that = this;
switch (_that) {
case _AuthSession() when $default != null:
return $default(_that.accessToken,_that.refreshToken,_that.user,_that.logoUrl,_that.loadingVideoUrl,_that.merchantStatus,_that.onboarding);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>(TResult Function( String accessToken,  String refreshToken,  AppUser user,  String? logoUrl,  String? loadingVideoUrl,  String merchantStatus,  OnboardingPrefill? onboarding)  $default,) {final _that = this;
switch (_that) {
case _AuthSession():
return $default(_that.accessToken,_that.refreshToken,_that.user,_that.logoUrl,_that.loadingVideoUrl,_that.merchantStatus,_that.onboarding);case _:
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>(TResult? Function( String accessToken,  String refreshToken,  AppUser user,  String? logoUrl,  String? loadingVideoUrl,  String merchantStatus,  OnboardingPrefill? onboarding)?  $default,) {final _that = this;
switch (_that) {
case _AuthSession() when $default != null:
return $default(_that.accessToken,_that.refreshToken,_that.user,_that.logoUrl,_that.loadingVideoUrl,_that.merchantStatus,_that.onboarding);case _:
  return null;

}
}

}

/// @nodoc
@JsonSerializable()

class _AuthSession implements AuthSession {
  const _AuthSession({required this.accessToken, required this.refreshToken, required this.user, this.logoUrl, this.loadingVideoUrl, required this.merchantStatus, this.onboarding});
  factory _AuthSession.fromJson(Map<String, dynamic> json) => _$AuthSessionFromJson(json);

@override final  String accessToken;
@override final  String refreshToken;
@override final  AppUser user;
@override final  String? logoUrl;
@override final  String? loadingVideoUrl;
@override final  String merchantStatus;
@override final  OnboardingPrefill? onboarding;

/// Create a copy of AuthSession
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
_$AuthSessionCopyWith<_AuthSession> get copyWith => __$AuthSessionCopyWithImpl<_AuthSession>(this, _$identity);

@override
Map<String, dynamic> toJson() {
  return _$AuthSessionToJson(this, );
}

@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is _AuthSession&&(identical(other.accessToken, accessToken) || other.accessToken == accessToken)&&(identical(other.refreshToken, refreshToken) || other.refreshToken == refreshToken)&&(identical(other.user, user) || other.user == user)&&(identical(other.logoUrl, logoUrl) || other.logoUrl == logoUrl)&&(identical(other.loadingVideoUrl, loadingVideoUrl) || other.loadingVideoUrl == loadingVideoUrl)&&(identical(other.merchantStatus, merchantStatus) || other.merchantStatus == merchantStatus)&&(identical(other.onboarding, onboarding) || other.onboarding == onboarding));
}

@JsonKey(includeFromJson: false, includeToJson: false)
@override
int get hashCode {
    return Object.hash(runtimeType,accessToken,refreshToken,user,logoUrl,loadingVideoUrl,merchantStatus,onboarding);
}

@override
String toString() {
    return 'AuthSession(accessToken: $accessToken, refreshToken: $refreshToken, user: $user, logoUrl: $logoUrl, loadingVideoUrl: $loadingVideoUrl, merchantStatus: $merchantStatus, onboarding: $onboarding)';
}


}

/// @nodoc
abstract mixin class _$AuthSessionCopyWith<$Res> implements $AuthSessionCopyWith<$Res> {
  factory _$AuthSessionCopyWith(_AuthSession value, $Res Function(_AuthSession) _then) = __$AuthSessionCopyWithImpl;
@override @useResult
$Res call({
 String accessToken, String refreshToken, AppUser user, String? logoUrl, String? loadingVideoUrl, String merchantStatus, OnboardingPrefill? onboarding
});


@override $AppUserCopyWith<$Res> get user;@override $OnboardingPrefillCopyWith<$Res>? get onboarding;

}
/// @nodoc
class __$AuthSessionCopyWithImpl<$Res>
    implements _$AuthSessionCopyWith<$Res> {
  __$AuthSessionCopyWithImpl(this._self, this._then);

  final _AuthSession _self;
  final $Res Function(_AuthSession) _then;

/// Create a copy of AuthSession
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? accessToken = null,Object? refreshToken = null,Object? user = null,Object? logoUrl = freezed,Object? loadingVideoUrl = freezed,Object? merchantStatus = null,Object? onboarding = freezed,}) {
  return _then(_AuthSession(
accessToken: null == accessToken ? _self.accessToken : accessToken // ignore: cast_nullable_to_non_nullable
as String,refreshToken: null == refreshToken ? _self.refreshToken : refreshToken // ignore: cast_nullable_to_non_nullable
as String,user: null == user ? _self.user : user // ignore: cast_nullable_to_non_nullable
as AppUser,logoUrl: freezed == logoUrl ? _self.logoUrl : logoUrl // ignore: cast_nullable_to_non_nullable
as String?,loadingVideoUrl: freezed == loadingVideoUrl ? _self.loadingVideoUrl : loadingVideoUrl // ignore: cast_nullable_to_non_nullable
as String?,merchantStatus: null == merchantStatus ? _self.merchantStatus : merchantStatus // ignore: cast_nullable_to_non_nullable
as String,onboarding: freezed == onboarding ? _self.onboarding : onboarding // ignore: cast_nullable_to_non_nullable
as OnboardingPrefill?,
  ));
}

/// Create a copy of AuthSession
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$AppUserCopyWith<$Res> get user {
  
  return $AppUserCopyWith<$Res>(_self.user, (value) {
    return _then(_self.copyWith(user: value));
  });
}/// Create a copy of AuthSession
/// with the given fields replaced by the non-null parameter values.
@override
@pragma('vm:prefer-inline')
$OnboardingPrefillCopyWith<$Res>? get onboarding {
    if (_self.onboarding == null) {
    return null;
  }

  return $OnboardingPrefillCopyWith<$Res>(_self.onboarding!, (value) {
    return _then(_self.copyWith(onboarding: value));
  });
}
}

// dart format on
