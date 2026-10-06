import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aicatalogueflutter/core/network/connectivity_service.dart';
import 'package:aicatalogueflutter/utils/app_strings.dart';
import 'package:aicatalogueflutter/widgets/offline_banner.dart';

void main() {
  group('ConnectivityService', () {
    test('reports the initial check result first', () async {
      final service = ConnectivityService(
        checkConnectivity: () async => [ConnectivityResult.wifi],
        onConnectivityChanged: () => const Stream.empty(),
      );
      expect(await service.watch().first, isTrue);
    });

    test('none among several results still counts as online', () async {
      final service = ConnectivityService(
        checkConnectivity: () async =>
            [ConnectivityResult.none, ConnectivityResult.mobile],
        onConnectivityChanged: () => const Stream.empty(),
      );
      expect(await service.watch().first, isTrue);
    });

    test('only none is offline', () async {
      final service = ConnectivityService(
        checkConnectivity: () async => [ConnectivityResult.none],
        onConnectivityChanged: () => const Stream.empty(),
      );
      expect(await service.watch().first, isFalse);
    });

    test('emits every later change after the initial value', () async {
      final changes = StreamController<List<ConnectivityResult>>();
      addTearDown(changes.close);
      final service = ConnectivityService(
        checkConnectivity: () async => [ConnectivityResult.wifi],
        onConnectivityChanged: () => changes.stream,
      );

      final values = <bool>[];
      final sub = service.watch().listen(values.add);
      addTearDown(sub.cancel);
      await Future<void>.delayed(Duration.zero);

      changes.add([ConnectivityResult.none]);
      await Future<void>.delayed(Duration.zero);
      changes.add([ConnectivityResult.mobile]);
      await Future<void>.delayed(Duration.zero);

      expect(values, [true, false, true]);
    });
  });

  group('OfflineBanner', () {
    Widget host(ConnectivityService service) => ProviderScope(
      overrides: [connectivityServiceProvider.overrideWithValue(service)],
      child: const MaterialApp(
        home: Scaffold(body: Stack(children: [OfflineBanner()])),
      ),
    );

    testWidgets('shows the message once offline is confirmed', (
      tester,
    ) async {
      final service = ConnectivityService(
        checkConnectivity: () async => [ConnectivityResult.none],
        onConnectivityChanged: () => const Stream.empty(),
      );
      await tester.pumpWidget(host(service));
      await tester.pump();

      expect(find.text(AppStrings.noInternetMessage), findsOneWidget);
    });

    testWidgets('stays off screen while online', (tester) async {
      final service = ConnectivityService(
        checkConnectivity: () async => [ConnectivityResult.wifi],
        onConnectivityChanged: () => const Stream.empty(),
      );
      await tester.pumpWidget(host(service));
      await tester.pump();

      // The text is still in the tree (AnimatedSlide keeps its child
      // mounted) — what matters is that it's slid up out of the viewport.
      final banner = tester.getTopLeft(find.text(AppStrings.noInternetMessage));
      expect(banner.dy, lessThan(0));
    });

    testWidgets('never intercepts taps on the screen beneath it', (
      tester,
    ) async {
      var tapped = false;
      final service = ConnectivityService(
        checkConnectivity: () async => [ConnectivityResult.none],
        onConnectivityChanged: () => const Stream.empty(),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [connectivityServiceProvider.overrideWithValue(service)],
          child: MaterialApp(
            home: Scaffold(
              body: Stack(
                children: [
                  Positioned.fill(
                    child: GestureDetector(onTap: () => tapped = true),
                  ),
                  const OfflineBanner(),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      await tester.tapAt(tester.getCenter(find.byType(OfflineBanner)));
      expect(tapped, isTrue);
    });
  });
}
