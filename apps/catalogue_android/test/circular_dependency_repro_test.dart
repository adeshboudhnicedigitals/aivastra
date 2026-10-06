import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

// Reproduces the exact shape of the app's dioProvider -> AuthInterceptor ->
// authRepositoryProvider -> authApiProvider -> dioProvider cycle, to check
// whether `ref.container.read()` actually avoids Riverpod's
// CircularDependencyError the way `ref.read()` does not.
void main() {
  test('ref.read() on a provider that depends back on the caller throws', () {
    late Object Function() lateRead;
    late final Provider<Object> b;

    final a = Provider<Object>((ref) {
      lateRead = () => ref.read(b);
      return Object();
    });
    b = Provider<Object>((ref) {
      ref.watch(a);
      return Object();
    });

    final container = ProviderContainer();
    addTearDown(container.dispose);

    container.read(a); // builds a, capturing its ref in lateRead
    container.read(b); // builds b, establishing the a<-b dependency edge
    expect(lateRead, throwsA(isA<Error>()));
  });

  test('ref.container.read() on the same setup does NOT throw', () {
    late Object Function() lateRead;
    late final Provider<Object> b;

    final a = Provider<Object>((ref) {
      lateRead = () => ref.container.read(b);
      return Object();
    });
    b = Provider<Object>((ref) {
      ref.watch(a);
      return Object();
    });

    final container = ProviderContainer();
    addTearDown(container.dispose);

    container.read(a);
    container.read(b);
    expect(lateRead, returnsNormally);
  });
}
