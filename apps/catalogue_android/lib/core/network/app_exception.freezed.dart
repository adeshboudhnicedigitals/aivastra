// GENERATED CODE - DO NOT MODIFY BY HAND
// coverage:ignore-file
// ignore_for_file: type=lint, type=warning, deprecated_member_use, deprecated_member_use_from_same_package
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'app_exception.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

// GENERATED CODE - DO NOT MODIFY BY HAND
// dart format off
T _$identity<T>(T value) => value;
/// @nodoc
mixin _$AppException {

 String get message;
/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$AppExceptionCopyWith<AppException> get copyWith => _$AppExceptionCopyWithImpl<AppException>(this as AppException, _$identity);



@override
bool operator ==(Object other) {
  final _this = this as AppException;
  return identical(this, other) || (other.runtimeType == runtimeType&&other is AppException&&(identical(other.message, _this.message) || other.message == _this.message));
}


@override
int get hashCode {
  final _this = this as AppException;
  return Object.hash(runtimeType,_this.message);
}

@override
String toString() {
  final _this = this as AppException;
  return 'AppException(message: ${_this.message})';
}


}

/// @nodoc
abstract mixin class $AppExceptionCopyWith<$Res>  {
  factory $AppExceptionCopyWith(AppException value, $Res Function(AppException) _then) = _$AppExceptionCopyWithImpl;
@useResult
$Res call({
 String message
});




}
/// @nodoc
class _$AppExceptionCopyWithImpl<$Res>
    implements $AppExceptionCopyWith<$Res> {
  _$AppExceptionCopyWithImpl(this._self, this._then);

  final AppException _self;
  final $Res Function(AppException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@pragma('vm:prefer-inline') @override $Res call({Object? message = null,}) {
  return _then(_self.copyWith(
message: null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}

}


/// Adds pattern-matching-related methods to [AppException].
extension AppExceptionPatterns on AppException {
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

@optionalTypeArgs TResult maybeMap<TResult extends Object?>({TResult Function( BadRequestException value)?  badRequest,TResult Function( UnauthorizedException value)?  unauthorized,TResult Function( EmailNotVerifiedException value)?  emailNotVerified,TResult Function( ForbiddenException value)?  forbidden,TResult Function( DeviceLimitReachedException value)?  deviceLimitReached,TResult Function( InvalidRefreshException value)?  invalidRefresh,TResult Function( RateLimitedException value)?  rateLimited,TResult Function( NetworkException value)?  network,TResult Function( ServerException value)?  server,TResult Function( UnknownException value)?  unknown,required TResult orElse(),}){
final _that = this;
switch (_that) {
case BadRequestException() when badRequest != null:
return badRequest(_that);case UnauthorizedException() when unauthorized != null:
return unauthorized(_that);case EmailNotVerifiedException() when emailNotVerified != null:
return emailNotVerified(_that);case ForbiddenException() when forbidden != null:
return forbidden(_that);case DeviceLimitReachedException() when deviceLimitReached != null:
return deviceLimitReached(_that);case InvalidRefreshException() when invalidRefresh != null:
return invalidRefresh(_that);case RateLimitedException() when rateLimited != null:
return rateLimited(_that);case NetworkException() when network != null:
return network(_that);case ServerException() when server != null:
return server(_that);case UnknownException() when unknown != null:
return unknown(_that);case _:
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

@optionalTypeArgs TResult map<TResult extends Object?>({required TResult Function( BadRequestException value)  badRequest,required TResult Function( UnauthorizedException value)  unauthorized,required TResult Function( EmailNotVerifiedException value)  emailNotVerified,required TResult Function( ForbiddenException value)  forbidden,required TResult Function( DeviceLimitReachedException value)  deviceLimitReached,required TResult Function( InvalidRefreshException value)  invalidRefresh,required TResult Function( RateLimitedException value)  rateLimited,required TResult Function( NetworkException value)  network,required TResult Function( ServerException value)  server,required TResult Function( UnknownException value)  unknown,}){
final _that = this;
switch (_that) {
case BadRequestException():
return badRequest(_that);case UnauthorizedException():
return unauthorized(_that);case EmailNotVerifiedException():
return emailNotVerified(_that);case ForbiddenException():
return forbidden(_that);case DeviceLimitReachedException():
return deviceLimitReached(_that);case InvalidRefreshException():
return invalidRefresh(_that);case RateLimitedException():
return rateLimited(_that);case NetworkException():
return network(_that);case ServerException():
return server(_that);case UnknownException():
return unknown(_that);}
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

@optionalTypeArgs TResult? mapOrNull<TResult extends Object?>({TResult? Function( BadRequestException value)?  badRequest,TResult? Function( UnauthorizedException value)?  unauthorized,TResult? Function( EmailNotVerifiedException value)?  emailNotVerified,TResult? Function( ForbiddenException value)?  forbidden,TResult? Function( DeviceLimitReachedException value)?  deviceLimitReached,TResult? Function( InvalidRefreshException value)?  invalidRefresh,TResult? Function( RateLimitedException value)?  rateLimited,TResult? Function( NetworkException value)?  network,TResult? Function( ServerException value)?  server,TResult? Function( UnknownException value)?  unknown,}){
final _that = this;
switch (_that) {
case BadRequestException() when badRequest != null:
return badRequest(_that);case UnauthorizedException() when unauthorized != null:
return unauthorized(_that);case EmailNotVerifiedException() when emailNotVerified != null:
return emailNotVerified(_that);case ForbiddenException() when forbidden != null:
return forbidden(_that);case DeviceLimitReachedException() when deviceLimitReached != null:
return deviceLimitReached(_that);case InvalidRefreshException() when invalidRefresh != null:
return invalidRefresh(_that);case RateLimitedException() when rateLimited != null:
return rateLimited(_that);case NetworkException() when network != null:
return network(_that);case ServerException() when server != null:
return server(_that);case UnknownException() when unknown != null:
return unknown(_that);case _:
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

@optionalTypeArgs TResult maybeWhen<TResult extends Object?>({TResult Function( String message)?  badRequest,TResult Function( String message)?  unauthorized,TResult Function( String message)?  emailNotVerified,TResult Function( String message)?  forbidden,TResult Function( String message,  String forceLogoutToken,  int maxActiveDevices,  List<ActiveDeviceInfo> activeDevices)?  deviceLimitReached,TResult Function( String message)?  invalidRefresh,TResult Function( String message)?  rateLimited,TResult Function( String message)?  network,TResult Function( String message)?  server,TResult Function( String message)?  unknown,required TResult orElse(),}) {final _that = this;
switch (_that) {
case BadRequestException() when badRequest != null:
return badRequest(_that.message);case UnauthorizedException() when unauthorized != null:
return unauthorized(_that.message);case EmailNotVerifiedException() when emailNotVerified != null:
return emailNotVerified(_that.message);case ForbiddenException() when forbidden != null:
return forbidden(_that.message);case DeviceLimitReachedException() when deviceLimitReached != null:
return deviceLimitReached(_that.message,_that.forceLogoutToken,_that.maxActiveDevices,_that.activeDevices);case InvalidRefreshException() when invalidRefresh != null:
return invalidRefresh(_that.message);case RateLimitedException() when rateLimited != null:
return rateLimited(_that.message);case NetworkException() when network != null:
return network(_that.message);case ServerException() when server != null:
return server(_that.message);case UnknownException() when unknown != null:
return unknown(_that.message);case _:
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

@optionalTypeArgs TResult when<TResult extends Object?>({required TResult Function( String message)  badRequest,required TResult Function( String message)  unauthorized,required TResult Function( String message)  emailNotVerified,required TResult Function( String message)  forbidden,required TResult Function( String message,  String forceLogoutToken,  int maxActiveDevices,  List<ActiveDeviceInfo> activeDevices)  deviceLimitReached,required TResult Function( String message)  invalidRefresh,required TResult Function( String message)  rateLimited,required TResult Function( String message)  network,required TResult Function( String message)  server,required TResult Function( String message)  unknown,}) {final _that = this;
switch (_that) {
case BadRequestException():
return badRequest(_that.message);case UnauthorizedException():
return unauthorized(_that.message);case EmailNotVerifiedException():
return emailNotVerified(_that.message);case ForbiddenException():
return forbidden(_that.message);case DeviceLimitReachedException():
return deviceLimitReached(_that.message,_that.forceLogoutToken,_that.maxActiveDevices,_that.activeDevices);case InvalidRefreshException():
return invalidRefresh(_that.message);case RateLimitedException():
return rateLimited(_that.message);case NetworkException():
return network(_that.message);case ServerException():
return server(_that.message);case UnknownException():
return unknown(_that.message);}
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

@optionalTypeArgs TResult? whenOrNull<TResult extends Object?>({TResult? Function( String message)?  badRequest,TResult? Function( String message)?  unauthorized,TResult? Function( String message)?  emailNotVerified,TResult? Function( String message)?  forbidden,TResult? Function( String message,  String forceLogoutToken,  int maxActiveDevices,  List<ActiveDeviceInfo> activeDevices)?  deviceLimitReached,TResult? Function( String message)?  invalidRefresh,TResult? Function( String message)?  rateLimited,TResult? Function( String message)?  network,TResult? Function( String message)?  server,TResult? Function( String message)?  unknown,}) {final _that = this;
switch (_that) {
case BadRequestException() when badRequest != null:
return badRequest(_that.message);case UnauthorizedException() when unauthorized != null:
return unauthorized(_that.message);case EmailNotVerifiedException() when emailNotVerified != null:
return emailNotVerified(_that.message);case ForbiddenException() when forbidden != null:
return forbidden(_that.message);case DeviceLimitReachedException() when deviceLimitReached != null:
return deviceLimitReached(_that.message,_that.forceLogoutToken,_that.maxActiveDevices,_that.activeDevices);case InvalidRefreshException() when invalidRefresh != null:
return invalidRefresh(_that.message);case RateLimitedException() when rateLimited != null:
return rateLimited(_that.message);case NetworkException() when network != null:
return network(_that.message);case ServerException() when server != null:
return server(_that.message);case UnknownException() when unknown != null:
return unknown(_that.message);case _:
  return null;

}
}

}

/// @nodoc


class BadRequestException implements AppException {
  const BadRequestException(this.message);
  

@override final  String message;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$BadRequestExceptionCopyWith<BadRequestException> get copyWith => _$BadRequestExceptionCopyWithImpl<BadRequestException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is BadRequestException&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message);
}

@override
String toString() {
    return 'AppException.badRequest(message: $message)';
}


}

/// @nodoc
abstract mixin class $BadRequestExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $BadRequestExceptionCopyWith(BadRequestException value, $Res Function(BadRequestException) _then) = _$BadRequestExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message
});




}
/// @nodoc
class _$BadRequestExceptionCopyWithImpl<$Res>
    implements $BadRequestExceptionCopyWith<$Res> {
  _$BadRequestExceptionCopyWithImpl(this._self, this._then);

  final BadRequestException _self;
  final $Res Function(BadRequestException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(BadRequestException(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class UnauthorizedException implements AppException {
  const UnauthorizedException(this.message);
  

@override final  String message;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$UnauthorizedExceptionCopyWith<UnauthorizedException> get copyWith => _$UnauthorizedExceptionCopyWithImpl<UnauthorizedException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is UnauthorizedException&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message);
}

@override
String toString() {
    return 'AppException.unauthorized(message: $message)';
}


}

/// @nodoc
abstract mixin class $UnauthorizedExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $UnauthorizedExceptionCopyWith(UnauthorizedException value, $Res Function(UnauthorizedException) _then) = _$UnauthorizedExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message
});




}
/// @nodoc
class _$UnauthorizedExceptionCopyWithImpl<$Res>
    implements $UnauthorizedExceptionCopyWith<$Res> {
  _$UnauthorizedExceptionCopyWithImpl(this._self, this._then);

  final UnauthorizedException _self;
  final $Res Function(UnauthorizedException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(UnauthorizedException(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class EmailNotVerifiedException implements AppException {
  const EmailNotVerifiedException(this.message);
  

@override final  String message;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$EmailNotVerifiedExceptionCopyWith<EmailNotVerifiedException> get copyWith => _$EmailNotVerifiedExceptionCopyWithImpl<EmailNotVerifiedException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is EmailNotVerifiedException&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message);
}

@override
String toString() {
    return 'AppException.emailNotVerified(message: $message)';
}


}

/// @nodoc
abstract mixin class $EmailNotVerifiedExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $EmailNotVerifiedExceptionCopyWith(EmailNotVerifiedException value, $Res Function(EmailNotVerifiedException) _then) = _$EmailNotVerifiedExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message
});




}
/// @nodoc
class _$EmailNotVerifiedExceptionCopyWithImpl<$Res>
    implements $EmailNotVerifiedExceptionCopyWith<$Res> {
  _$EmailNotVerifiedExceptionCopyWithImpl(this._self, this._then);

  final EmailNotVerifiedException _self;
  final $Res Function(EmailNotVerifiedException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(EmailNotVerifiedException(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class ForbiddenException implements AppException {
  const ForbiddenException(this.message);
  

@override final  String message;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$ForbiddenExceptionCopyWith<ForbiddenException> get copyWith => _$ForbiddenExceptionCopyWithImpl<ForbiddenException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is ForbiddenException&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message);
}

@override
String toString() {
    return 'AppException.forbidden(message: $message)';
}


}

/// @nodoc
abstract mixin class $ForbiddenExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $ForbiddenExceptionCopyWith(ForbiddenException value, $Res Function(ForbiddenException) _then) = _$ForbiddenExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message
});




}
/// @nodoc
class _$ForbiddenExceptionCopyWithImpl<$Res>
    implements $ForbiddenExceptionCopyWith<$Res> {
  _$ForbiddenExceptionCopyWithImpl(this._self, this._then);

  final ForbiddenException _self;
  final $Res Function(ForbiddenException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(ForbiddenException(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class DeviceLimitReachedException implements AppException {
  const DeviceLimitReachedException({required this.message, required this.forceLogoutToken, required this.maxActiveDevices, required  List<ActiveDeviceInfo> activeDevices}): _activeDevices = activeDevices;
  

@override final  String message;
 final  String forceLogoutToken;
 final  int maxActiveDevices;
 final  List<ActiveDeviceInfo> _activeDevices;
 List<ActiveDeviceInfo> get activeDevices {
  if (_activeDevices is EqualUnmodifiableListView) return _activeDevices;
  // ignore: implicit_dynamic_type
  return EqualUnmodifiableListView(_activeDevices);
}


/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$DeviceLimitReachedExceptionCopyWith<DeviceLimitReachedException> get copyWith => _$DeviceLimitReachedExceptionCopyWithImpl<DeviceLimitReachedException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is DeviceLimitReachedException&&(identical(other.message, message) || other.message == message)&&(identical(other.forceLogoutToken, forceLogoutToken) || other.forceLogoutToken == forceLogoutToken)&&(identical(other.maxActiveDevices, maxActiveDevices) || other.maxActiveDevices == maxActiveDevices)&&const DeepCollectionEquality().equals(other.activeDevices, _activeDevices));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message,forceLogoutToken,maxActiveDevices,const DeepCollectionEquality().hash(_activeDevices));
}

@override
String toString() {
    return 'AppException.deviceLimitReached(message: $message, forceLogoutToken: $forceLogoutToken, maxActiveDevices: $maxActiveDevices, activeDevices: $activeDevices)';
}


}

/// @nodoc
abstract mixin class $DeviceLimitReachedExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $DeviceLimitReachedExceptionCopyWith(DeviceLimitReachedException value, $Res Function(DeviceLimitReachedException) _then) = _$DeviceLimitReachedExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message, String forceLogoutToken, int maxActiveDevices, List<ActiveDeviceInfo> activeDevices
});




}
/// @nodoc
class _$DeviceLimitReachedExceptionCopyWithImpl<$Res>
    implements $DeviceLimitReachedExceptionCopyWith<$Res> {
  _$DeviceLimitReachedExceptionCopyWithImpl(this._self, this._then);

  final DeviceLimitReachedException _self;
  final $Res Function(DeviceLimitReachedException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,Object? forceLogoutToken = null,Object? maxActiveDevices = null,Object? activeDevices = null,}) {
  return _then(DeviceLimitReachedException(
message: null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,forceLogoutToken: null == forceLogoutToken ? _self.forceLogoutToken : forceLogoutToken // ignore: cast_nullable_to_non_nullable
as String,maxActiveDevices: null == maxActiveDevices ? _self.maxActiveDevices : maxActiveDevices // ignore: cast_nullable_to_non_nullable
as int,activeDevices: null == activeDevices ? _self._activeDevices : activeDevices // ignore: cast_nullable_to_non_nullable
as List<ActiveDeviceInfo>,
  ));
}


}

/// @nodoc


class InvalidRefreshException implements AppException {
  const InvalidRefreshException(this.message);
  

@override final  String message;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$InvalidRefreshExceptionCopyWith<InvalidRefreshException> get copyWith => _$InvalidRefreshExceptionCopyWithImpl<InvalidRefreshException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is InvalidRefreshException&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message);
}

@override
String toString() {
    return 'AppException.invalidRefresh(message: $message)';
}


}

/// @nodoc
abstract mixin class $InvalidRefreshExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $InvalidRefreshExceptionCopyWith(InvalidRefreshException value, $Res Function(InvalidRefreshException) _then) = _$InvalidRefreshExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message
});




}
/// @nodoc
class _$InvalidRefreshExceptionCopyWithImpl<$Res>
    implements $InvalidRefreshExceptionCopyWith<$Res> {
  _$InvalidRefreshExceptionCopyWithImpl(this._self, this._then);

  final InvalidRefreshException _self;
  final $Res Function(InvalidRefreshException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(InvalidRefreshException(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class RateLimitedException implements AppException {
  const RateLimitedException(this.message);
  

@override final  String message;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$RateLimitedExceptionCopyWith<RateLimitedException> get copyWith => _$RateLimitedExceptionCopyWithImpl<RateLimitedException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is RateLimitedException&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message);
}

@override
String toString() {
    return 'AppException.rateLimited(message: $message)';
}


}

/// @nodoc
abstract mixin class $RateLimitedExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $RateLimitedExceptionCopyWith(RateLimitedException value, $Res Function(RateLimitedException) _then) = _$RateLimitedExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message
});




}
/// @nodoc
class _$RateLimitedExceptionCopyWithImpl<$Res>
    implements $RateLimitedExceptionCopyWith<$Res> {
  _$RateLimitedExceptionCopyWithImpl(this._self, this._then);

  final RateLimitedException _self;
  final $Res Function(RateLimitedException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(RateLimitedException(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class NetworkException implements AppException {
  const NetworkException(this.message);
  

@override final  String message;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$NetworkExceptionCopyWith<NetworkException> get copyWith => _$NetworkExceptionCopyWithImpl<NetworkException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is NetworkException&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message);
}

@override
String toString() {
    return 'AppException.network(message: $message)';
}


}

/// @nodoc
abstract mixin class $NetworkExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $NetworkExceptionCopyWith(NetworkException value, $Res Function(NetworkException) _then) = _$NetworkExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message
});




}
/// @nodoc
class _$NetworkExceptionCopyWithImpl<$Res>
    implements $NetworkExceptionCopyWith<$Res> {
  _$NetworkExceptionCopyWithImpl(this._self, this._then);

  final NetworkException _self;
  final $Res Function(NetworkException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(NetworkException(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class ServerException implements AppException {
  const ServerException(this.message);
  

@override final  String message;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$ServerExceptionCopyWith<ServerException> get copyWith => _$ServerExceptionCopyWithImpl<ServerException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is ServerException&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message);
}

@override
String toString() {
    return 'AppException.server(message: $message)';
}


}

/// @nodoc
abstract mixin class $ServerExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $ServerExceptionCopyWith(ServerException value, $Res Function(ServerException) _then) = _$ServerExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message
});




}
/// @nodoc
class _$ServerExceptionCopyWithImpl<$Res>
    implements $ServerExceptionCopyWith<$Res> {
  _$ServerExceptionCopyWithImpl(this._self, this._then);

  final ServerException _self;
  final $Res Function(ServerException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(ServerException(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

/// @nodoc


class UnknownException implements AppException {
  const UnknownException(this.message);
  

@override final  String message;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @JsonKey(includeFromJson: false, includeToJson: false)
@pragma('vm:prefer-inline')
$UnknownExceptionCopyWith<UnknownException> get copyWith => _$UnknownExceptionCopyWithImpl<UnknownException>(this, _$identity);



@override
bool operator ==(Object other) {
    return identical(this, other) || (other.runtimeType == runtimeType&&other is UnknownException&&(identical(other.message, message) || other.message == message));
}


@override
int get hashCode {
    return Object.hash(runtimeType,message);
}

@override
String toString() {
    return 'AppException.unknown(message: $message)';
}


}

/// @nodoc
abstract mixin class $UnknownExceptionCopyWith<$Res> implements $AppExceptionCopyWith<$Res> {
  factory $UnknownExceptionCopyWith(UnknownException value, $Res Function(UnknownException) _then) = _$UnknownExceptionCopyWithImpl;
@override @useResult
$Res call({
 String message
});




}
/// @nodoc
class _$UnknownExceptionCopyWithImpl<$Res>
    implements $UnknownExceptionCopyWith<$Res> {
  _$UnknownExceptionCopyWithImpl(this._self, this._then);

  final UnknownException _self;
  final $Res Function(UnknownException) _then;

/// Create a copy of AppException
/// with the given fields replaced by the non-null parameter values.
@override @pragma('vm:prefer-inline') $Res call({Object? message = null,}) {
  return _then(UnknownException(
null == message ? _self.message : message // ignore: cast_nullable_to_non_nullable
as String,
  ));
}


}

// dart format on
