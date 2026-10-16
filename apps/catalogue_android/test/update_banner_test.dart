import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:in_app_update/in_app_update.dart';

import 'package:aicatalogueflutter/core/network/connectivity_service.dart';
import 'package:aicatalogueflutter/core/update/update_service.dart';
import 'package:aicatalogueflutter/utils/app_strings.dart';
import 'package:aicatalogueflutter/widgets/update_banner.dart';

AppUpdateInfo _info({required UpdateAvailability availability}) =>
    AppUpdateInfo(
      updateAvailability: availability,
      immediateUpdateAllowed: false,
      immediateAllowedPreconditions: null,
      flexibleUpdateAllowed: true,
      flexibleAllowedPreconditions: null,
      availableVersionCode: 2,
      installStatus: InstallStatus.unknown,
      packageName: 'com.nice.aivastracatalogue',
      clientVersionStalenessDays: null,
      updatePriority: 0,
    );

void main() {
  group('UpdateBanner', () {
    Widget host({
      required UpdateService updateService,
      ConnectivityService? connectivityService,
    }) => ProviderScope(
      overrides: [
        updateServiceProvider.overrideWithValue(updateService),
        connectivityServiceProvider.overrideWithValue(
          connectivityService ??
              ConnectivityService(
                checkConnectivity: () async => [ConnectivityResult.wifi],
                onConnectivityChanged: () => const Stream.empty(),
              ),
        ),
      ],
      child: const MaterialApp(
        home: Scaffold(body: Stack(children: [UpdateBanner()])),
      ),
    );

    testWidgets('stays off screen when no update is available', (
      tester,
    ) async {
      final service = UpdateService(
        checkForUpdate: () async =>
            _info(availability: UpdateAvailability.updateNotAvailable),
        startFlexibleUpdate: () async => AppUpdateResult.success,
        completeFlexibleUpdate: () async {},
        installUpdateListener: () => const Stream.empty(),
      );
      await tester.pumpWidget(host(updateService: service));
      await tester.pumpAndSettle();

      final banner = tester.getTopLeft(
        find.text(AppStrings.updateReadyMessage),
      );
      expect(banner.dy, lessThan(0));
    });

    testWidgets('shows once the download finishes, and Restart installs it', (
      tester,
    ) async {
      final installController = StreamController<InstallStatus>();
      addTearDown(installController.close);
      var installed = false;

      final service = UpdateService(
        checkForUpdate: () async =>
            _info(availability: UpdateAvailability.updateAvailable),
        startFlexibleUpdate: () async => AppUpdateResult.success,
        completeFlexibleUpdate: () async => installed = true,
        installUpdateListener: () => installController.stream,
      );
      await tester.pumpWidget(host(updateService: service));
      await tester.pumpAndSettle();

      // Still downloading — nothing to show yet.
      var banner = tester.getTopLeft(find.text(AppStrings.updateReadyMessage));
      expect(banner.dy, lessThan(0));

      installController.add(InstallStatus.downloaded);
      await tester.pumpAndSettle();

      banner = tester.getTopLeft(find.text(AppStrings.updateReadyMessage));
      expect(banner.dy, greaterThanOrEqualTo(0));

      await tester.tap(find.text(AppStrings.updateNowLabel));
      expect(installed, isTrue);
    });

    testWidgets('Close dismisses the banner', (tester) async {
      final installController = StreamController<InstallStatus>();
      addTearDown(installController.close);

      final service = UpdateService(
        checkForUpdate: () async =>
            _info(availability: UpdateAvailability.updateAvailable),
        startFlexibleUpdate: () async => AppUpdateResult.success,
        completeFlexibleUpdate: () async {},
        installUpdateListener: () => installController.stream,
      );
      await tester.pumpWidget(host(updateService: service));
      await tester.pumpAndSettle();
      installController.add(InstallStatus.downloaded);
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.close_rounded));
      await tester.pumpAndSettle();

      final banner = tester.getTopLeft(
        find.text(AppStrings.updateReadyMessage),
      );
      expect(banner.dy, lessThan(0));
    });

    testWidgets('stays hidden while offline even if ready to install', (
      tester,
    ) async {
      final installController = StreamController<InstallStatus>();
      addTearDown(installController.close);

      final service = UpdateService(
        checkForUpdate: () async =>
            _info(availability: UpdateAvailability.updateAvailable),
        startFlexibleUpdate: () async => AppUpdateResult.success,
        completeFlexibleUpdate: () async {},
        installUpdateListener: () => installController.stream,
      );
      await tester.pumpWidget(
        host(
          updateService: service,
          connectivityService: ConnectivityService(
            checkConnectivity: () async => [ConnectivityResult.none],
            onConnectivityChanged: () => const Stream.empty(),
          ),
        ),
      );
      await tester.pump();
      installController.add(InstallStatus.downloaded);
      await tester.pump();

      final banner = tester.getTopLeft(
        find.text(AppStrings.updateReadyMessage),
      );
      expect(banner.dy, lessThan(0));
    });
  });
}
