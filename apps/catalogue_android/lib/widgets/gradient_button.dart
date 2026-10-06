import 'package:flutter/material.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import 'app_loader.dart';

enum GradientButtonIconPosition { leading, trailing }

class GradientButton extends StatelessWidget {
  const GradientButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.gradient = AppColors.pinkGradient,
    this.icon,
    this.iconPosition = GradientButtonIconPosition.leading,
    this.textStyle,
    this.width,
    this.borderRadius,
    this.padding,
    this.gap,
    this.isLoading = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final Gradient gradient;
  final Widget? icon;
  final GradientButtonIconPosition iconPosition;
  final TextStyle? textStyle;
  final double? width;
  final double? borderRadius;
  final EdgeInsetsGeometry? padding;
  final double? gap;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(
      borderRadius ?? AppDimens.sdp(context, '_20sdp'),
    );
    final resolvedPadding =
        padding ??
        EdgeInsets.symmetric(
          horizontal: AppDimens.sdp(context, '_28sdp'),
          vertical: AppDimens.sdp(context, '_16sdp'),
        );
    final resolvedGap = gap ?? AppDimens.sdp(context, '_10sdp');
    final isDisabled = onPressed == null || isLoading;

    final text = Flexible(
      child: Text(
        label,
        overflow: TextOverflow.ellipsis,
        textAlign: TextAlign.center,
        style:
            textStyle ??
            AppTextStyles.semiBold.copyWith(
              color: Colors.white,
              fontSize: AppDimens.ssp(context, '_16ssp'),
            ),
      ),
    );

    final content = isLoading
        ? const AppLoader.button()
        : Row(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (icon != null &&
                  iconPosition == GradientButtonIconPosition.leading) ...[
                icon!,
                SizedBox(width: resolvedGap),
              ],
              text,
              if (icon != null &&
                  iconPosition == GradientButtonIconPosition.trailing) ...[
                SizedBox(width: resolvedGap),
                icon!,
              ],
            ],
          );

    return Opacity(
      opacity: (onPressed == null && !isLoading) ? 0.5 : 1,
      child: SizedBox(
        width: width ?? double.infinity,
        child: Material(
          color: Colors.transparent,
          borderRadius: radius,
          child: InkWell(
            onTap: isDisabled ? null : onPressed,
            borderRadius: radius,
            child: Ink(
              padding: resolvedPadding,
              decoration: BoxDecoration(
                gradient: gradient,
                borderRadius: radius,
              ),
              child: content,
            ),
          ),
        ),
      ),
    );
  }
}
