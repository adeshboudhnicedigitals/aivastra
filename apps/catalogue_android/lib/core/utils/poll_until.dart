import 'dart:async';

import '../network/app_exception.dart';

/// Repeatedly calls [fetch] every [interval] until [isTerminal] returns true
/// for its result, or [timeout] elapses. Shared by any screen that needs to
/// wait on an async backend job (image/video generation) via polling instead
/// of a push channel.
Future<T> pollUntil<T>(
  Future<T> Function() fetch,
  bool Function(T value) isTerminal, {
  Duration interval = const Duration(seconds: 2),
  Duration timeout = const Duration(minutes: 3),
}) async {
  final deadline = DateTime.now().add(timeout);
  var result = await fetch();
  while (!isTerminal(result)) {
    if (DateTime.now().isAfter(deadline)) {
      throw const AppException.unknown(
        'Timed out waiting for the job to finish.',
      );
    }
    await Future.delayed(interval);
    result = await fetch();
  }
  return result;
}
