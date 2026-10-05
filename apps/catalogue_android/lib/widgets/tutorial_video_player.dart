import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/tutorials/tutorial_data.dart';

/// YouTube's embed player rejects a request with no Referer ("Error 153"),
/// and asks WebView apps to identify themselves as `https://<application id>`.
/// Loading the embed page with this as its base URL is what sets that header.
const _embedOrigin = 'https://com.nice.aivastracatalogue';

/// Plays [tutorial] in a dialog over the current page instead of handing off
/// to the YouTube app. The WebView is only created here, on tap, so the
/// tutorials list itself stays as cheap as a list of thumbnails.
Future<void> showTutorialPlayer(BuildContext context, Tutorial tutorial) {
  return showDialog<void>(
    context: context,
    barrierColor: Colors.black.withValues(alpha: 0.85),
    builder: (_) => _TutorialPlayerDialog(tutorial: tutorial),
  );
}

class _TutorialPlayerDialog extends StatefulWidget {
  const _TutorialPlayerDialog({required this.tutorial});

  final Tutorial tutorial;

  @override
  State<_TutorialPlayerDialog> createState() => _TutorialPlayerDialogState();
}

class _TutorialPlayerDialogState extends State<_TutorialPlayerDialog> {
  late final WebViewController _controller;
  bool _loaded = false;

  @override
  void initState() {
    super.initState();

    // iOS plays every <video> fullscreen unless inline playback is allowed.
    final params = WebViewPlatform.instance is WebKitWebViewPlatform
        ? WebKitWebViewControllerCreationParams(
            allowsInlineMediaPlayback: true,
            mediaTypesRequiringUserAction: const {},
          )
        : const PlatformWebViewControllerCreationParams();

    _controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: (_) {
            if (mounted) setState(() => _loaded = true);
          },
          // The player's own links (title, YouTube logo) would otherwise
          // replace the embed with the full YouTube site inside this box.
          onNavigationRequest: (request) =>
              request.isMainFrame && !request.url.startsWith(_embedOrigin)
              ? NavigationDecision.prevent
              : NavigationDecision.navigate,
        ),
      );

    // Without this Android ignores autoplay and the user has to tap twice.
    final platform = _controller.platform;
    if (platform is AndroidWebViewController) {
      platform.setMediaPlaybackRequiresUserGesture(false);
    }

    _controller.loadHtmlString(_embedHtml, baseUrl: _embedOrigin);
  }

  @override
  void dispose() {
    // Removing the widget doesn't stop the page; blank it or the audio keeps
    // playing after the dialog closes.
    _controller.loadRequest(Uri.parse('about:blank'));
    super.dispose();
  }

  String get _embedHtml =>
      '''
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  iframe { border: 0; width: 100%; height: 100%; }
</style>
</head>
<body>
<iframe
  src="https://www.youtube.com/embed/${widget.tutorial.videoId}?autoplay=1&playsinline=1&rel=0&fs=0"
  allow="autoplay; encrypted-media; picture-in-picture"
  referrerpolicy="strict-origin-when-cross-origin"></iframe>
</body>
</html>
''';

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    final inset = AppDimens.sdp(context, '_12sdp');
    final pad = AppDimens.sdp(context, '_12sdp');
    final headerHeight = AppDimens.sdp(context, '_48sdp');
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_18sdp'));

    // Width is whichever is tighter: the screen's width, or the width whose
    // 16:9 frame still fits the screen's height (landscape phones).
    final availableHeight = size.height - headerHeight - (inset + pad) * 2;
    final width = math.max(
      200.0,
      math.min(
        math.min(size.width - inset * 2, 720.0),
        availableHeight * 16 / 9 + pad * 2,
      ),
    );

    return Dialog(
      backgroundColor: AppColors.background,
      insetPadding: EdgeInsets.all(inset),
      shape: RoundedRectangleBorder(
        borderRadius: radius,
        side: BorderSide(color: AppColors.fieldBorder),
      ),
      clipBehavior: Clip.antiAlias,
      child: SizedBox(
        width: width,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              height: headerHeight,
              child: Row(
                children: [
                  SizedBox(width: pad),
                  Expanded(
                    child: Text(
                      widget.tutorial.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.semiBold.copyWith(
                        color: Colors.white,
                        fontSize: AppDimens.ssp(context, '_13ssp'),
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.close_rounded, color: Colors.white),
                  ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.fromLTRB(pad, 0, pad, pad),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(
                  AppDimens.sdp(context, '_12sdp'),
                ),
                child: AspectRatio(
                  aspectRatio: 16 / 9,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      const ColoredBox(color: Colors.black),
                      WebViewWidget(controller: _controller),
                      if (!_loaded)
                        const Center(
                          child: CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
