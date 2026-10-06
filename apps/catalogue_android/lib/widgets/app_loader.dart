import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';

/// The app's one loading spinner. Every screen and button uses this instead
/// of a raw [CircularProgressIndicator], so the size, weight and colour stay
/// the same everywhere and can be changed in one place.
///
/// A plain [CircularProgressIndicator] on its own is just one moving arc —
/// with nothing behind it, that arc reads as a curved line sweeping around
/// rather than a round dial. This draws a full, faint ring first (a
/// determinate indicator pinned at 100%) and the coloured arc on top of it,
/// so there is always a complete circle on screen and the moving arc reads
/// as travelling around a dial, not as a bar by itself.
///
/// Pick the constructor for where it sits:
///  * [AppLoader.new] — a centred spinner filling its space (a page or card
///    that is loading).
///  * [AppLoader.section] — the same with generous vertical padding, for a
///    list or section that is loading between other content.
///  * [AppLoader.small] — a compact pink spinner for inline use (inside a
///    row, a tile or an upload box). Not centred; the parent positions it.
///  * [AppLoader.button] — a compact white spinner for filled/gradient
///    buttons and dark photo overlays. Not centred.
class AppLoader extends StatelessWidget {
  /// A centred pink spinner.
  const AppLoader({super.key})
    : _sizeKey = '_28sdp',
      _stroke = 3,
      _color = AppColors.pinkGradientStart,
      _centered = true,
      _paddingKey = null;

  /// A centred pink spinner with vertical padding around it.
  const AppLoader.section({super.key})
    : _sizeKey = '_28sdp',
      _stroke = 3,
      _color = AppColors.pinkGradientStart,
      _centered = true,
      _paddingKey = '_40sdp';

  /// A compact pink spinner for inline use.
  const AppLoader.small({super.key})
    : _sizeKey = '_16sdp',
      _stroke = 2.4,
      _color = AppColors.pinkGradientStart,
      _centered = false,
      _paddingKey = null;

  /// A compact white spinner for buttons and dark overlays.
  const AppLoader.button({super.key})
    : _sizeKey = '_20sdp',
      _stroke = 2.4,
      _color = Colors.white,
      _centered = false,
      _paddingKey = null;

  final String _sizeKey;
  final double _stroke;
  final Color _color;
  final bool _centered;
  final String? _paddingKey;

  @override
  Widget build(BuildContext context) {
    final size = AppDimens.sdp(context, _sizeKey);
    Widget spinner = SizedBox(
      width: size,
      height: size,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // The full dial, always visible, so the moving arc below reads as
          // travelling around a circle rather than floating on its own.
          CircularProgressIndicator(
            strokeWidth: _stroke,
            value: 1,
            valueColor: AlwaysStoppedAnimation(_color.withValues(alpha: 0.2)),
          ),
          CircularProgressIndicator(
            strokeWidth: _stroke,
            valueColor: AlwaysStoppedAnimation(_color),
          ),
        ],
      ),
    );
    final paddingKey = _paddingKey;
    if (paddingKey != null) {
      spinner = Padding(
        padding: EdgeInsets.symmetric(
          vertical: AppDimens.sdp(context, paddingKey),
        ),
        child: spinner,
      );
    }
    return _centered ? Center(child: spinner) : spinner;
  }
}
