import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import 'app_text_styles.dart';

class AppTheme {
  AppTheme._();

  static ThemeData get light => ThemeData(
    useMaterial3: true,
    fontFamily: 'Poppins',
    colorScheme: ColorScheme.fromSeed(seedColor: Colors.deepPurple),
    // One transition for every push/pop in the app, on every platform,
    // instead of each OS's own default (Android's predictive-back fade,
    // iOS's native slide) — the horizontal slide-with-swipe-back most
    // fashion/e-commerce apps use everywhere, Android included, because its
    // direction (forward = slide in from the right, back = reverse) reads
    // instantly. Applies to both MaterialPageRoute pushes and GoRouter's
    // MaterialPage routes, since both read this same theme property.
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: CupertinoPageTransitionsBuilder(),
        TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
        TargetPlatform.windows: CupertinoPageTransitionsBuilder(),
        TargetPlatform.linux: CupertinoPageTransitionsBuilder(),
        TargetPlatform.fuchsia: CupertinoPageTransitionsBuilder(),
      },
    ),
    // Every showModalBottomSheet() call in the app relies on this rather
    // than passing its own barrierColor — Flutter's own default
    // (Colors.black54) let this app's bright gradient page backgrounds
    // show through too clearly behind an open sheet. A single theme-level
    // value keeps every sheet consistently dimmed without touching each
    // call site.
    bottomSheetTheme: BottomSheetThemeData(
      modalBarrierColor: Colors.black.withValues(alpha: 0.88),
    ),
    textTheme: const TextTheme(
      displayLarge: AppTextStyles.bold,
      displayMedium: AppTextStyles.bold,
      displaySmall: AppTextStyles.semiBold,
      headlineLarge: AppTextStyles.semiBold,
      headlineMedium: AppTextStyles.semiBold,
      headlineSmall: AppTextStyles.medium,
      titleLarge: AppTextStyles.semiBold,
      titleMedium: AppTextStyles.medium,
      titleSmall: AppTextStyles.medium,
      bodyLarge: AppTextStyles.regular,
      bodyMedium: AppTextStyles.regular,
      bodySmall: AppTextStyles.light,
      labelLarge: AppTextStyles.medium,
      labelMedium: AppTextStyles.regular,
      labelSmall: AppTextStyles.light,
    ),
  );
}
