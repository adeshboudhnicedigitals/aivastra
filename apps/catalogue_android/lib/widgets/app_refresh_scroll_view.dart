import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';

/// The app's one pull-to-refresh scroll view: a vertically scrolling page
/// whose content can be pulled down to reload, styled to match the dark theme
/// (pink spinner on the sheet colour).
///
/// It always accepts the pull gesture, even when the content is shorter than
/// the screen — a plain [SingleChildScrollView] doesn't overscroll then, so
/// [RefreshIndicator] would never trigger on a short or empty page.
///
/// [onRefresh] should finish once the new data has arrived (await the
/// providers it invalidated) so the spinner stays for exactly as long as the
/// reload takes. Use [awaitQuietly] for those awaits.
class AppRefreshScrollView extends StatelessWidget {
  const AppRefreshScrollView({
    super.key,
    required this.onRefresh,
    required Widget this.child,
    this.padding,
  }) : slivers = null;

  /// For pages with a long list: [slivers] are built as they scroll into
  /// view instead of all up front. [padding] wraps them as one block — the
  /// top inset before the first, the bottom after the last.
  const AppRefreshScrollView.slivers({
    super.key,
    required this.onRefresh,
    required List<Widget> this.slivers,
    this.padding,
  }) : child = null;

  final Future<void> Function() onRefresh;
  final Widget? child;
  final List<Widget>? slivers;
  final EdgeInsetsGeometry? padding;

  Widget _scrollView(BuildContext context) {
    final slivers = this.slivers;
    if (slivers == null) {
      return SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: padding,
        child: child,
      );
    }

    final insets =
        padding?.resolve(Directionality.of(context)) ?? EdgeInsets.zero;
    return CustomScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: [
        for (var i = 0; i < slivers.length; i++)
          SliverPadding(
            padding: EdgeInsets.fromLTRB(
              insets.left,
              i == 0 ? insets.top : 0,
              insets.right,
              i == slivers.length - 1 ? insets.bottom : 0,
            ),
            sliver: slivers[i],
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      color: AppColors.pinkGradientStart,
      backgroundColor: AppColors.sheetBackground,
      displacement: AppDimens.sdp(context, '_40sdp'),
      onRefresh: () async {
        // A failed reload already shows its own error state where the data
        // is used; letting it escape here would only surface as an unhandled
        // exception from the gesture.
        try {
          await onRefresh();
        } catch (_) {}
      },
      child: _scrollView(context),
    );
  }
}

/// Awaits [future] but swallows its error, for use inside an `onRefresh`:
/// one failed request shouldn't stop the others from being awaited, and the
/// failure is already visible in the provider's own error state.
Future<void> awaitQuietly(Future<Object?> future) async {
  try {
    await future;
  } catch (_) {}
}
