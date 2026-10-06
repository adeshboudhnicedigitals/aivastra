import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../app/app_routes.dart';
import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/auth/application/login_view_model.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/gradient_button.dart';

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  String? _localValidationError;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      setState(() => _localValidationError = AppStrings.loginFieldsRequired);
      return;
    }
    setState(() => _localValidationError = null);

    final viewModel = ref.read(loginViewModelProvider.notifier);
    final success = await viewModel.submit(email: email, password: password);
    if (!mounted) return;

    final state = ref.read(loginViewModelProvider);
    if (state.deviceLimit != null) {
      _showDeviceLimitDialog();
      return;
    }
    if (success) {
      context.go(AppRoutes.home);
    } else if (state.errorMessage != null &&
        state.errorMessage!.toLowerCase().contains('verify')) {
      context.go(
        '${AppRoutes.verifyEmailPending}?email=${Uri.encodeComponent(email)}',
      );
    }
  }

  Future<void> _handleGoogleSignIn() async {
    try {
      final account = await GoogleSignIn.instance.authenticate();
      final idToken = account.authentication.idToken;
      if (idToken == null) return;

      final success = await ref
          .read(loginViewModelProvider.notifier)
          .loginWithGoogle(idToken);
      if (!mounted) return;
      if (success) context.go(AppRoutes.home);
    } on GoogleSignInException catch (e) {
      if (e.code == GoogleSignInExceptionCode.canceled) return;
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.description ?? 'Google sign-in failed.')),
      );
    }
  }

  void _showDeviceLimitDialog() {
    final viewModel = ref.read(loginViewModelProvider.notifier);
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return Consumer(
          builder: (context, ref, _) {
            final state = ref.watch(loginViewModelProvider);
            final limit = state.deviceLimit;
            if (limit == null) return const SizedBox.shrink();
            return DeviceLimitDialog(
              message: limit.message,
              activeDevices: limit.activeDevices,
              isSubmitting: state.isSubmitting,
              onForceLogin: () async {
                final ok = await viewModel.forceLogin();
                if (!dialogContext.mounted) return;
                Navigator.of(dialogContext).pop();
                if (ok && mounted) context.go(AppRoutes.home);
              },
              onCancel: () {
                viewModel.dismissDeviceLimit();
                Navigator.of(dialogContext).pop();
              },
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(loginViewModelProvider);
    final errorMessage = _localValidationError ?? state.errorMessage;

    return AuthPageScaffold(
      title: AppStrings.welcomeBack,
      subtitle: AppStrings.signInSubtitle,
      formChild: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GoogleSignInButton(onPressed: _handleGoogleSignIn),
          SizedBox(height: AppDimens.sdp(context, '_30sdp')),
          const OrDivider(),
          SizedBox(height: AppDimens.sdp(context, '_30sdp')),
          if (errorMessage != null) ...[
            InlineErrorBanner(message: errorMessage),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          ],
          const FieldLabel(AppStrings.email),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
          AuthTextField(
            controller: _emailController,
            hint: AppStrings.enterYourEmail,
            prefixIconAsset: AppAssets.emailIcon,
            keyboardType: TextInputType.emailAddress,
          ),
          SizedBox(height: AppDimens.sdp(context, '_20sdp')),
          const FieldLabel(AppStrings.password),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
          AuthTextField(
            controller: _passwordController,
            hint: AppStrings.enterYourPassword,
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
              onPressed: () {
                setState(() {
                  _obscurePassword = !_obscurePassword;
                });
              },
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: () => context.go(AppRoutes.forgotPassword),
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                minimumSize: const Size(0, 32),
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(
                AppStrings.forgotPassword,
                style: AppTextStyles.medium.copyWith(
                  color: Colors.white,
                  fontSize: AppDimens.ssp(context, '_13ssp'),
                ),
              ),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_12sdp')),
          GradientButton(
            label: AppStrings.continueLabel,
            isLoading: state.isSubmitting,
            onPressed: _submit,
            borderRadius: AppDimens.sdp(context, '_25sdp'),
          ),
          SizedBox(height: AppDimens.sdp(context, '_20sdp')),
          Center(
            child: Wrap(
              alignment: WrapAlignment.center,
              children: [
                Text(
                  AppStrings.dontHaveAccount,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_13ssp'),
                  ),
                ),
                GestureDetector(
                  onTap: () => context.push(AppRoutes.signup),
                  child: Text(
                    AppStrings.signUp,
                    style: AppTextStyles.semiBold.copyWith(
                      color: AppColors.pinkGradientStart,
                      fontSize: AppDimens.ssp(context, '_13ssp'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
