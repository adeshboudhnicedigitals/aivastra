import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../core/network/active_device_info.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';
import 'gradient_button.dart';

class AuthPageScaffold extends StatelessWidget {
  const AuthPageScaffold({
    super.key,
    required this.title,
    required this.subtitle,
    required this.formChild,
  });

  final String title;
  final String subtitle;
  final Widget formChild;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;
    final isTablet = AppDimens.isTablet(context);
    final outerPadding = AppDimens.sdp(context, '_24sdp');
    final topPadding =
        outerPadding + (isTablet ? AppDimens.sdp(context, '_24sdp') : 0);
    final maxWidth = AppDimens.sdp(context, '_screen_container_width');
    final logoHeight = isTablet
        ? AppDimens.sdp(context, '_64sdp')
        : AppDimens.sdp(context, '_40sdp');

    final content = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(child: Image.asset(AppAssets.logo, height: logoHeight)),
        SizedBox(height: AppDimens.sdp(context, '_32sdp')),
        Text(
          title,
          textAlign: TextAlign.center,
          style: AppTextStyles.semiBold.copyWith(
            color: Colors.white,
            fontSize: AppDimens.ssp(context, '_22ssp'),
          ),
        ),
        SizedBox(height: AppDimens.sdp(context, '_6sdp')),
        Text(
          subtitle,
          textAlign: TextAlign.center,
          style: AppTextStyles.regular.copyWith(
            color: AppColors.textSecondary,
            fontSize: AppDimens.ssp(context, '_14ssp'),
          ),
        ),
        SizedBox(height: AppDimens.sdp(context, '_32sdp')),
        formChild,
      ],
    );

    return Scaffold(
      backgroundColor: AppColors.background,
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          Positioned.fill(
            child: Image.asset(AppAssets.backgroundGlow, fit: BoxFit.cover),
          ),
          SafeArea(
            child: Align(
              alignment: Alignment.topCenter,
              child: ConstrainedBox(
                constraints: BoxConstraints(maxWidth: maxWidth),
                child: isTablet
                    ? LayoutBuilder(
                        builder: (context, constraints) {
                          return SingleChildScrollView(
                            padding: EdgeInsets.fromLTRB(
                              outerPadding,
                              topPadding,
                              outerPadding,
                              outerPadding + bottomInset,
                            ),
                            child: ConstrainedBox(
                              constraints: BoxConstraints(
                                minHeight:
                                    constraints.maxHeight -
                                    topPadding -
                                    outerPadding -
                                    bottomInset,
                              ),
                              child: Center(child: content),
                            ),
                          );
                        },
                      )
                    : SingleChildScrollView(
                        padding: EdgeInsets.fromLTRB(
                          outerPadding,
                          topPadding,
                          outerPadding,
                          outerPadding + bottomInset,
                        ),
                        child: content,
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: AppTextStyles.medium.copyWith(
        color: Colors.white,
        fontSize: AppDimens.ssp(context, '_14ssp'),
      ),
    );
  }
}

class AuthTextField extends StatelessWidget {
  const AuthTextField({
    super.key,
    required this.controller,
    required this.hint,
    required this.prefixIconAsset,
    this.obscureText = false,
    this.suffixIcon,
    this.keyboardType,
  });

  final TextEditingController controller;
  final String hint;
  final String prefixIconAsset;
  final bool obscureText;
  final Widget? suffixIcon;
  final TextInputType? keyboardType;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_25sdp'));
    final fontSize = AppDimens.ssp(context, '_14ssp');

    return TextField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      style: AppTextStyles.regular.copyWith(
        color: Colors.white,
        fontSize: fontSize,
      ),
      cursorColor: Colors.white,
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: AppTextStyles.regular.copyWith(
          color: AppColors.textSecondary,
          fontSize: fontSize,
        ),
        prefixIcon: Padding(
          padding: EdgeInsets.all(AppDimens.sdp(context, '_15sdp')),
          child: SvgPicture.asset(
            prefixIconAsset,
            width: AppDimens.sdp(context, '_18sdp'),
            height: AppDimens.sdp(context, '_18sdp'),
            colorFilter: const ColorFilter.mode(
              AppColors.textSecondary,
              BlendMode.srcIn,
            ),
          ),
        ),
        suffixIcon: suffixIcon,
        filled: true,
        fillColor: AppColors.fieldFill,
        contentPadding: EdgeInsets.symmetric(
          vertical: AppDimens.sdp(context, '_14sdp'),
        ),
        border: OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: AppColors.fieldBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: radius,
          borderSide: BorderSide(color: AppColors.fieldBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: radius,
          borderSide: const BorderSide(color: AppColors.pinkGradientEnd),
        ),
      ),
    );
  }
}

class GoogleSignInButton extends StatelessWidget {
  const GoogleSignInButton({
    super.key,
    required this.onPressed,
    this.label = AppStrings.continueWithGoogle,
  });

  final VoidCallback onPressed;
  final String label;

  @override
  Widget build(BuildContext context) {
    final radius = BorderRadius.circular(AppDimens.sdp(context, '_25sdp'));
    final iconSize = AppDimens.sdp(context, '_20sdp');

    return Material(
      color: AppColors.fieldFill,
      borderRadius: radius,
      child: InkWell(
        onTap: onPressed,
        borderRadius: radius,
        child: Container(
          padding: EdgeInsets.symmetric(
            vertical: AppDimens.sdp(context, '_14sdp'),
          ),
          decoration: BoxDecoration(
            borderRadius: radius,
            border: Border.all(color: AppColors.fieldBorder),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SvgPicture.asset(
                AppAssets.googleIcon,
                width: iconSize,
                height: iconSize,
              ),
              SizedBox(width: AppDimens.sdp(context, '_10sdp')),
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.medium.copyWith(
                    color: Colors.white,
                    fontSize: AppDimens.ssp(context, '_14ssp'),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class OrDivider extends StatelessWidget {
  const OrDivider({super.key});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: Divider(color: AppColors.fieldBorder)),
        Padding(
          padding: EdgeInsets.symmetric(
            horizontal: AppDimens.sdp(context, '_12sdp'),
          ),
          child: Text(
            AppStrings.or,
            style: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_13ssp'),
            ),
          ),
        ),
        Expanded(child: Divider(color: AppColors.fieldBorder)),
      ],
    );
  }
}

/// Reusable red-tinted message box for surfacing API errors inline on a form.
class InlineErrorBanner extends StatelessWidget {
  const InlineErrorBanner({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(AppDimens.sdp(context, '_12sdp')),
      decoration: BoxDecoration(
        color: AppColors.danger.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_14sdp')),
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.error_outline_rounded,
            color: AppColors.danger,
            size: AppDimens.sdp(context, '_18sdp'),
          ),
          SizedBox(width: AppDimens.sdp(context, '_8sdp')),
          Expanded(
            child: Text(
              message,
              style: AppTextStyles.regular.copyWith(
                color: AppColors.danger,
                fontSize: AppDimens.ssp(context, '_13ssp'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Shown when a `kiosk`-platform login hits `409 DEVICE_LIMIT_REACHED`,
/// listing the currently active device(s) and offering to force-logout the
/// other session and continue on this device.
class DeviceLimitDialog extends StatelessWidget {
  const DeviceLimitDialog({
    super.key,
    required this.message,
    required this.activeDevices,
    required this.isSubmitting,
    required this.onForceLogin,
    required this.onCancel,
  });

  final String message;
  final List<ActiveDeviceInfo> activeDevices;
  final bool isSubmitting;
  final VoidCallback onForceLogin;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppColors.sheetBackground,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppDimens.sdp(context, '_20sdp')),
      ),
      child: Padding(
        padding: EdgeInsets.all(AppDimens.sdp(context, '_20sdp')),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              message,
              style: AppTextStyles.semiBold.copyWith(
                color: Colors.white,
                fontSize: AppDimens.ssp(context, '_16ssp'),
              ),
            ),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
            for (final device in activeDevices)
              Padding(
                padding: EdgeInsets.symmetric(
                  vertical: AppDimens.sdp(context, '_6sdp'),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.devices_other_rounded,
                      color: AppColors.textSecondary,
                      size: AppDimens.sdp(context, '_18sdp'),
                    ),
                    SizedBox(width: AppDimens.sdp(context, '_10sdp')),
                    Expanded(
                      child: Text(
                        device.deviceName ?? device.deviceId,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.regular.copyWith(
                          color: Colors.white,
                          fontSize: AppDimens.ssp(context, '_13ssp'),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            SizedBox(height: AppDimens.sdp(context, '_20sdp')),
            GradientButton(
              label: 'Log out other device & continue',
              isLoading: isSubmitting,
              onPressed: onForceLogin,
            ),
            SizedBox(height: AppDimens.sdp(context, '_10sdp')),
            TextButton(
              onPressed: isSubmitting ? null : onCancel,
              child: Text(
                'Cancel',
                style: AppTextStyles.medium.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_14ssp'),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
