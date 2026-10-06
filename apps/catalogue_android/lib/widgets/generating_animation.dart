import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';

/// Fashion-themed "your image is being made" placeholder: a swinging hanger
/// in a pulsing glow, drifting fabric waves, twinkling sparkles and a soft
/// light sweep, with a rotating status line. One [AnimationController] drives
/// everything, and the moving parts are a single [CustomPainter] behind a
/// [RepaintBoundary] — cheap enough to leave running for the whole
/// generation.
///
/// Every motion is a whole number of cycles per [_loop], so the loop restarts
/// without a visible jump.
class GeneratingAnimation extends StatefulWidget {
  const GeneratingAnimation({super.key, this.steps = _defaultSteps});

  /// Each step pairs a status line with the fashion icon shown above it; both
  /// change together.
  final List<({IconData icon, String text})> steps;

  static const _defaultSteps = [
    (icon: Icons.checkroom_rounded, text: 'Styling your model…'),
    (icon: Icons.dry_cleaning_rounded, text: 'Draping the fabric…'),
    (icon: Icons.content_cut_rounded, text: 'Tailoring the fit…'),
    (icon: Icons.photo_camera_outlined, text: 'Setting the scene…'),
    (icon: Icons.diamond_outlined, text: 'Adding the finishing touches…'),
  ];

  @override
  State<GeneratingAnimation> createState() => _GeneratingAnimationState();
}

const _loop = Duration(seconds: 4);

class _GeneratingAnimationState extends State<GeneratingAnimation>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  Timer? _messageTimer;
  int _messageIndex = 0;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(vsync: this, duration: _loop)..repeat();
    _messageTimer = Timer.periodic(const Duration(milliseconds: 2600), (_) {
      if (!mounted) return;
      setState(() => _messageIndex = (_messageIndex + 1) % widget.steps.length);
    });
  }

  @override
  void dispose() {
    _messageTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final glowSize = AppDimens.sdp(context, '_100sdp');

    return RepaintBoundary(
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              AppColors.pinkGradientStart.withValues(alpha: 0.28),
              const Color(0xFF14101C),
              AppColors.pinkGradientStart.withValues(alpha: 0.16),
            ],
          ),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            Positioned.fill(
              child: AnimatedBuilder(
                animation: _controller,
                builder: (_, _) => CustomPaint(
                  painter: _GeneratingPainter(
                    _controller.value,
                    AppColors.pinkGradientStart,
                  ),
                ),
              ),
            ),
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedBuilder(
                    animation: _controller,
                    builder: (_, _) {
                      final t = _controller.value * 2 * math.pi;
                      final pulse = 0.5 + 0.5 * math.sin(t);
                      return SizedBox(
                        width: glowSize,
                        height: glowSize,
                        child: Stack(
                          alignment: Alignment.center,
                          children: [
                            Transform.scale(
                              scale: 0.85 + 0.2 * pulse,
                              child: Container(
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  gradient: RadialGradient(
                                    colors: [
                                      AppColors.pinkGradientStart.withValues(
                                        alpha: 0.35 + 0.15 * pulse,
                                      ),
                                      AppColors.pinkGradientStart.withValues(
                                        alpha: 0,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            // Hangs from its hook: pivot at the top centre.
                            Transform.rotate(
                              angle: math.sin(t) * 0.2,
                              alignment: Alignment.topCenter,
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 400),
                                transitionBuilder: (child, animation) =>
                                    ScaleTransition(
                                      scale: animation,
                                      child: FadeTransition(
                                        opacity: animation,
                                        child: child,
                                      ),
                                    ),
                                child: Icon(
                                  widget.steps[_messageIndex].icon,
                                  key: ValueKey(_messageIndex),
                                  color: Colors.white,
                                  size: AppDimens.sdp(context, '_60sdp'),
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                  SizedBox(height: AppDimens.sdp(context, '_8sdp')),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 400),
                    child: Text(
                      widget.steps[_messageIndex].text,
                      key: ValueKey(_messageIndex),
                      textAlign: TextAlign.center,
                      style: AppTextStyles.medium.copyWith(
                        color: Colors.white.withValues(alpha: 0.9),
                        fontSize: AppDimens.ssp(context, '_13ssp'),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GeneratingPainter extends CustomPainter {
  _GeneratingPainter(this.t, this.color);

  final double t; // 0..1 over one loop
  final Color color;

  // (x, y, phase, radius) — fractions of the canvas.
  static const _sparkles = [
    (0.18, 0.16, 0.0, 7.0),
    (0.82, 0.22, 0.35, 5.0),
    (0.12, 0.62, 0.6, 5.0),
    (0.88, 0.58, 0.15, 8.0),
    (0.3, 0.84, 0.8, 6.0),
    (0.7, 0.12, 0.5, 4.0),
    (0.62, 0.8, 0.25, 5.0),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    _paintShimmer(canvas, size);
    _paintWaves(canvas, size);
    _paintSparkles(canvas, size);
  }

  void _paintShimmer(Canvas canvas, Size size) {
    // Diagonal light band sweeping left → right, twice per loop.
    final p = (t * 2) % 1;
    final x = -size.width * 0.5 + p * size.width * 2;
    final rect = Rect.fromLTWH(x, 0, size.width * 0.5, size.height);
    canvas.save();
    canvas.translate(rect.center.dx, rect.center.dy);
    canvas.rotate(-0.35);
    canvas.translate(-rect.center.dx, -rect.center.dy);
    final paint = Paint()
      ..shader = LinearGradient(
        colors: [
          Colors.white.withValues(alpha: 0),
          Colors.white.withValues(alpha: 0.07),
          Colors.white.withValues(alpha: 0),
        ],
      ).createShader(rect);
    canvas.drawRect(rect.inflate(size.height), paint);
    canvas.restore();
  }

  void _paintWaves(Canvas canvas, Size size) {
    // Two layers of drifting cloth folds along the bottom.
    for (var layer = 0; layer < 2; layer++) {
      final base = size.height * (0.82 - layer * 0.07);
      final amp = size.height * (0.03 + layer * 0.012);
      final dir = layer == 0 ? 1 : -1;
      final phase = t * 2 * math.pi * dir;
      final path = Path()..moveTo(0, size.height);
      for (var x = 0.0; x <= size.width; x += 4) {
        final y =
            base + amp * math.sin((x / size.width) * 2 * math.pi * 1.5 + phase);
        path.lineTo(x, y);
      }
      path
        ..lineTo(size.width, size.height)
        ..close();
      canvas.drawPath(
        path,
        Paint()..color = color.withValues(alpha: layer == 0 ? 0.22 : 0.14),
      );
    }
  }

  void _paintSparkles(Canvas canvas, Size size) {
    final paint = Paint();
    for (final (fx, fy, phase, radius) in _sparkles) {
      // Two twinkles per loop, offset per sparkle.
      final tw = math.sin(math.pi * (((t * 2) + phase) % 1));
      if (tw <= 0.02) continue;
      final r = radius * (0.4 + 0.6 * tw);
      paint.color = Colors.white.withValues(alpha: 0.85 * tw);
      final c = Offset(fx * size.width, fy * size.height);
      // Four-point star.
      final path = Path()
        ..moveTo(c.dx, c.dy - r * 1.6)
        ..quadraticBezierTo(c.dx, c.dy, c.dx + r * 1.6, c.dy)
        ..quadraticBezierTo(c.dx, c.dy, c.dx, c.dy + r * 1.6)
        ..quadraticBezierTo(c.dx, c.dy, c.dx - r * 1.6, c.dy)
        ..quadraticBezierTo(c.dx, c.dy, c.dx, c.dy - r * 1.6)
        ..close();
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_GeneratingPainter old) =>
      old.t != t || old.color != color;
}
