import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/app_routes.dart';
import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/auth/application/forgot_password_view_model.dart';
import '../utils/app_constants.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/gradient_button.dart';

class ForgotPasswordPage extends ConsumerStatefulWidget {
  const ForgotPasswordPage({super.key});

  @override
  ConsumerState<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends ConsumerState<ForgotPasswordPage> {
  final _emailController = TextEditingController();

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(forgotPasswordViewModelProvider);
    final viewModel = ref.read(forgotPasswordViewModelProvider.notifier);

    return AuthPageScaffold(
      title: 'Forgot Password?',
      subtitle: "Enter your email and we'll send you a reset link.",
      formChild: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (state.errorMessage != null) ...[
            InlineErrorBanner(message: state.errorMessage!),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          ] else if (state.sent) ...[
            Text(
              'If an account exists for that email, a reset link is on '
              'its way.',
              textAlign: TextAlign.center,
              style: AppTextStyles.medium.copyWith(
                color: AppColors.success,
                fontSize: AppDimens.ssp(context, '_13ssp'),
              ),
            ),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          ],
          const FieldLabel('Email'),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
          AuthTextField(
            controller: _emailController,
            hint: 'Enter your email',
            prefixIconAsset: AppAssets.emailIcon,
            keyboardType: TextInputType.emailAddress,
          ),
          SizedBox(height: AppDimens.sdp(context, '_20sdp')),
          GradientButton(
            label: 'Send Reset Link',
            isLoading: state.isSubmitting,
            onPressed: () => viewModel.submit(_emailController.text.trim()),
          ),
          SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          Center(
            child: GestureDetector(
              onTap: () => context.go(AppRoutes.resetPassword),
              child: Text(
                'I already have a reset code',
                style: AppTextStyles.semiBold.copyWith(
                  color: AppColors.pinkGradientStart,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_10sdp')),
          Center(
            child: GestureDetector(
              onTap: () => context.go(AppRoutes.login),
              child: Text(
                'Back to Log In',
                style: AppTextStyles.medium.copyWith(
                  color: AppColors.textSecondary,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
