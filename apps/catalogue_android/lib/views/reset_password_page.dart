import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/app_routes.dart';
import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/auth/application/reset_password_view_model.dart';
import '../utils/app_constants.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/gradient_button.dart';

/// Reachable from the "I already have a reset code" link on Forgot Password.
/// `initialToken` is pre-filled when the page is opened with `?token=...`
/// (ready for a future deep link from the reset email); otherwise the user
/// pastes the token from the email manually.
class ResetPasswordPage extends ConsumerStatefulWidget {
  const ResetPasswordPage({super.key, this.initialToken});

  final String? initialToken;

  @override
  ConsumerState<ResetPasswordPage> createState() => _ResetPasswordPageState();
}

class _ResetPasswordPageState extends ConsumerState<ResetPasswordPage> {
  late final _tokenController = TextEditingController(
    text: widget.initialToken,
  );
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _tokenController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(resetPasswordViewModelProvider);
    final viewModel = ref.read(resetPasswordViewModelProvider.notifier);

    return AuthPageScaffold(
      title: 'Reset Password',
      subtitle:
          'Paste the code from your reset email and choose a new '
          'password.',
      formChild: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (state.errorMessage != null) ...[
            InlineErrorBanner(message: state.errorMessage!),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          ] else if (state.success) ...[
            Text(
              'Password reset. You can now log in with your new password.',
              textAlign: TextAlign.center,
              style: AppTextStyles.medium.copyWith(
                color: AppColors.success,
                fontSize: AppDimens.ssp(context, '_13ssp'),
              ),
            ),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          ],
          const FieldLabel('Reset Code'),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
          AuthTextField(
            controller: _tokenController,
            hint: 'Paste the code from your email',
            prefixIconAsset: AppAssets.lockIcon,
          ),
          SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          const FieldLabel('New Password'),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
          AuthTextField(
            controller: _passwordController,
            hint: 'Enter your new password',
            prefixIconAsset: AppAssets.lockIcon,
            obscureText: _obscurePassword,
            suffixIcon: IconButton(
              splashRadius: 20,
              icon: Icon(
                _obscurePassword
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                color: AppColors.textSecondary,
                size: AppDimens.sdp(context, '_20sdp'),
              ),
              onPressed: () =>
                  setState(() => _obscurePassword = !_obscurePassword),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_20sdp')),
          GradientButton(
            label: 'Reset Password',
            isLoading: state.isSubmitting,
            onPressed: () => viewModel.submit(
              token: _tokenController.text.trim(),
              newPassword: _passwordController.text,
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_16sdp')),
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
