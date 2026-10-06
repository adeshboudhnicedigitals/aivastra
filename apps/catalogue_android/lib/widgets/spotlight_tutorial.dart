import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import 'gradient_button.dart';

/// One stop in a [showSpotlightTutorial] walkthrough — a real on-screen
/// widget (identified by [targetKey]) gets a pulsing highlight ring plus an
/// explanatory text bubble next to it.
class SpotlightStep {
  const SpotlightStep({
    required this.targetKey,
    required this.title,
    required this.description,
  });

  final GlobalKey targetKey;
  final String title;
  final String description;
}

/// Shows a full-screen, step-by-step spotlight walkthrough over the current
/// page: each [SpotlightStep]'s target widget gets a dimmed-background
/// cutout plus a pulsing "wave" ring, with a text bubble (title/description)
/// and Next/Skip controls. Each target is scrolled into view first via
/// [Scrollable.ensureVisible], since these targets typically live inside a
/// scrollable form.
///
/// [onFinished] fires exactly once — whether the user steps through every
/// stop or taps Skip along the way — so callers can persist a "seen" flag
/// and never show this again.
void showSpotlightTutorial(
  BuildContext context, {
  required List<SpotlightStep> steps,
  required VoidCallback onFinished,
}) {
  if (steps.isEmpty) {
    onFinished();
    return;
  }
  late final OverlayEntry entry;
  entry = OverlayEntry(
    builder: (_) => _SpotlightOverlay(
      steps: steps,
      onFinished: () {
        entry.remove();
        onFinished();
      },
    ),
  );
  Overlay.of(context, rootOverlay: true).insert(entry);
}

class _SpotlightOverlay extends StatefulWidget {
  const _SpotlightOverlay({required this.steps, required this.onFinished});

  final List<SpotlightStep> steps;
  final VoidCallback onFinished;

  @override
  State<_SpotlightOverlay> createState() => _SpotlightOverlayState();
}

class _SpotlightOverlayState extends State<_SpotlightOverlay>
    with SingleTickerProviderStateMixin {
  int _index = 0;
  Rect? _targetRect;
  late final AnimationController _pulseController;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat();
    WidgetsBinding.instance.addPostFrameCallback((_) => _measureCurrent());
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  SpotlightStep get _step => widget.steps[_index];

  Future<void> _measureCurrent() async {
    final key = _step.targetKey;
    if (key.currentContext == null) {
      // Target never mounted (e.g. an upload box for a garment type that
      // hasn't resolved yet) — move on rather than stranding the overlay
      // with nothing to point at.
      _advance();
      return;
    }
    try {
      await Scrollable.ensureVisible(
        key.currentContext!,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
        alignment: 0.25,
      );
    } catch (_) {
      // Scrolling is a nicety, not a requirement — fall through and measure
      // wherever the target already is rather than stranding this step.
    }
    if (!mounted) return;
    // Re-read fresh rather than reusing the pre-await context — the target
    // could have unmounted while scrolling settled.
    final box = key.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.attached) {
      _advance();
      return;
    }
    final origin = box.localToGlobal(Offset.zero);
    setState(() => _targetRect = origin & box.size);
  }

  void _advance() {
    if (_index >= widget.steps.length - 1) {
      widget.onFinished();
      return;
    }
    setState(() {
      _index++;
      _targetRect = null;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) => _measureCurrent());
  }

  @override
  Widget build(BuildContext context) {
    final rect = _targetRect?.inflate(AppDimens.sdp(context, '_8sdp'));
    final screenSize = MediaQuery.sizeOf(context);
    final viewPadding = MediaQuery.paddingOf(context);
    final isLast = _index == widget.steps.length - 1;

    return Material(
      color: Colors.transparent,
      child: Stack(
        children: [
          // Swallows every tap on the real page underneath — this is a
          // guided tour, not a dismissible tooltip.
          const Positioned.fill(child: SizedBox.shrink()),
          if (rect != null)
            Positioned.fill(
              child: IgnorePointer(
                child: AnimatedBuilder(
                  animation: _pulseController,
                  builder: (context, _) => CustomPaint(
                    painter: _SpotlightPainter(
                      rect: rect,
                      pulse: _pulseController.value,
                      radius: AppDimens.sdp(context, '_14sdp'),
                    ),
                  ),
                ),
              ),
            ),
          if (rect != null)
            _TutorialBubble(
              anchorRect: rect,
              screenSize: screenSize,
              viewPadding: viewPadding,
              title: _step.title,
              description: _step.description,
              stepLabel: '${_index + 1}/${widget.steps.length}',
              isLast: isLast,
              onSkip: widget.onFinished,
              onNext: _advance,
            ),
        ],
      ),
    );
  }
}

class _SpotlightPainter extends CustomPainter {
  _SpotlightPainter({
    required this.rect,
    required this.pulse,
    required this.radius,
  });

  final Rect rect;
  final double pulse; // 0..1, looping
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final fullScreen = Path()..addRect(Offset.zero & size);
    final cutout = Path()
      ..addRRect(RRect.fromRectAndRadius(rect, Radius.circular(radius)));
    final dimmed = Path.combine(PathOperation.difference, fullScreen, cutout);
    canvas.drawPath(dimmed, Paint()..color = Colors.black.withValues(alpha: 0.72));

    // The "wave": a ring that expands outward from the cutout and fades as
    // it grows, looping continuously to keep drawing the eye back.
    final waveInflate = pulse * radius * 2.2;
    final wavePaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..color = AppColors.pinkGradientStart.withValues(alpha: (1 - pulse) * 0.85);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        rect.inflate(waveInflate),
        Radius.circular(radius + waveInflate),
      ),
      wavePaint,
    );

    // A steady ring right at the cutout's own edge, so the target still
    // reads as highlighted between wave pulses.
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect, Radius.circular(radius)),
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = AppColors.pinkGradientStart,
    );
  }

  @override
  bool shouldRepaint(covariant _SpotlightPainter oldDelegate) =>
      oldDelegate.rect != rect || oldDelegate.pulse != pulse;
}

class _TutorialBubble extends StatelessWidget {
  const _TutorialBubble({
    required this.anchorRect,
    required this.screenSize,
    required this.viewPadding,
    required this.title,
    required this.description,
    required this.stepLabel,
    required this.isLast,
    required this.onSkip,
    required this.onNext,
  });

  final Rect anchorRect;
  final Size screenSize;
  final EdgeInsets viewPadding;
  final String title;
  final String description;
  final String stepLabel;
  final bool isLast;
  final VoidCallback onSkip;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    // Prefer the target's underside; flip above it when there isn't enough
    // room below (e.g. the target sits just above the bottom nav bar).
    final spaceBelow = screenSize.height - anchorRect.bottom - viewPadding.bottom;
    final placeBelow = spaceBelow > AppDimens.sdp(context, '_180sdp');
    final horizontalMargin = AppDimens.sdp(context, '_20sdp');

    final bubble = Container(
      padding: EdgeInsets.all(AppDimens.sdp(context, '_16sdp')),
      decoration: BoxDecoration(
        color: AppColors.sheetBackground,
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_16sdp')),
        border: Border.all(color: AppColors.fieldBorder),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.4),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  title,
                  style: AppTextStyles.semiBold.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_15ssp'),
                  ),
                ),
              ),
              SizedBox(width: AppDimens.sdp(context, '_8sdp')),
              Text(
                stepLabel,
                style: AppTextStyles.medium.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_11ssp'),
                ),
              ),
            ],
          ),
          SizedBox(height: AppDimens.sdp(context, '_6sdp')),
          Text(
            description,
            style: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_13ssp'),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_14sdp')),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TextButton(
                onPressed: onSkip,
                style: TextButton.styleFrom(padding: EdgeInsets.zero),
                child: Text(
                  'Skip',
                  style: AppTextStyles.medium.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_13ssp'),
                  ),
                ),
              ),
              GradientButton(
                label: isLast ? 'Got It' : 'Next',
                onPressed: onNext,
                width: AppDimens.sdp(context, '_100sdp'),
                padding: EdgeInsets.symmetric(
                  vertical: AppDimens.sdp(context, '_10sdp'),
                ),
                textStyle: AppTextStyles.semiBold.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
            ],
          ),
        ],
      ),
    );

    return Positioned(
      left: horizontalMargin,
      right: horizontalMargin,
      top: placeBelow
          ? anchorRect.bottom + AppDimens.sdp(context, '_16sdp')
          : null,
      bottom: placeBelow
          ? null
          : (screenSize.height - anchorRect.top) +
                AppDimens.sdp(context, '_16sdp'),
      child: bubble,
    );
  }
}
