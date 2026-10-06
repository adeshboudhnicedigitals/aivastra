import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../utils/app_strings.dart';
import '../widgets/offline_banner.dart';
import 'router/app_router.dart';
import 'theme/app_theme.dart';

class App extends ConsumerWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: AppStrings.appName,
      theme: AppTheme.light,
      routerConfig: router,
      // The theme is `light` but every screen is dark, so the default status
      // bar icons (dark on a light theme) were invisible against it.
      builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
        value: const SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.light,
          statusBarBrightness: Brightness.dark,
        ),
        // Stacked once here, over whatever screen/route is showing, so every
        // screen gets the offline banner for free instead of each one having
        // to add it.
        child: Stack(
          children: [
            child ?? const SizedBox.shrink(),
            const OfflineBanner(),
          ],
        ),
      ),
    );
  }
}
