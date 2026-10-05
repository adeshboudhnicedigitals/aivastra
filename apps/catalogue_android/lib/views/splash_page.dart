import 'dart:async';

import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';

/// The branded launch screen: the background shows immediately, the logo
/// and tagline fade in about a second later, then the router moves on once
/// both this reveal and auth bootstrap have finished (see [splashHoldProvider]
/// in `app_router.dart` — without it, bootstrapping ahead of `runApp` would
/// let the redirect skip straight past this screen before it ever painted).
class SplashPage extends StatefulWidget {
  const SplashPage({super.key});

  @override
  State<SplashPage> createState() => _SplashPageState();
}

class _SplashPageState extends State<SplashPage> {
  bool _brandVisible = false;
  Timer? _revealTimer;

  @override
  void initState() {
    super.initState();
    _revealTimer = Timer(
      const Duration(milliseconds: 1000),
      () => mounted ? setState(() => _brandVisible = true) : null,
    );
  }

  @override
  void dispose() {
    _revealTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final logoHeight = AppDimens.sdp(context, '_48sdp');

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          Positioned.fill(
            child: Image.asset(AppAssets.splashBackground, fit: BoxFit.cover),
          ),
          Center(
            child: AnimatedOpacity(
              opacity: _brandVisible ? 1 : 0,
              duration: const Duration(milliseconds: 500),
              curve: Curves.easeOut,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Image.asset(AppAssets.logo, height: logoHeight),
                  SizedBox(height: AppDimens.sdp(context, '_14sdp')),
                  Text(
                    AppStrings.splashTagline,
                    style: AppTextStyles.bold.copyWith(
                      color: Colors.white,
                      fontSize: AppDimens.ssp(context, '_12ssp'),
                      letterSpacing: 1.2,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
