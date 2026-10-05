import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../app/app_routes.dart';
import '../features/auth/application/login_view_model.dart';
import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/auth/application/signup_view_model.dart';
import '../utils/app_constants.dart';
import '../utils/app_strings.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/gradient_button.dart';

/// Matches the backend's rules: password 8-128 chars with >=1 letter and
/// >=1 number, display name 1-80 chars.
final _passwordRule = RegExp(r'^(?=.*[A-Za-z])(?=.*\d).{8,128}$');

class SignupPage extends ConsumerStatefulWidget {
  const SignupPage({super.key});

  @override
  ConsumerState<SignupPage> createState() => _SignupPageState();
}

class _SignupPageState extends ConsumerState<SignupPage> {
  final _fullNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _obscurePassword = true;
  bool _obscureConfirmPassword = true;
  String? _localValidationError;

  @override
  void dispose() {
    _fullNameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final displayName = _fullNameController.text.trim();
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    final confirmPassword = _confirmPasswordController.text;

    setState(() => _localValidationError = null);

    if (displayName.isEmpty || displayName.length > 80) {
      setState(() => _localValidationError = 'Please enter your full name.');
      return;
    }
    if (!_passwordRule.hasMatch(password)) {
      setState(
        () => _localValidationError = 'Password must be 8-128 characters with at least one letter and one number.',
      );
      return;
    }
    if (password != confirmPassword) {
      setState(() => _localValidationError = 'Passwords do not match.');
      return;
    }

    final viewModel = ref.read(signupViewModelProvider.notifier);
    final success = await viewModel.submit(
      email: email,
      password: password,
      displayName: displayName,
    );
    if (!mounted || !success) return;

    context.go(
      '${AppRoutes.verifyEmailPending}?email=${Uri.encodeComponent(email)}',
    );
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

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(signupViewModelProvider);
    final errorMessage = _localValidationError ?? state.errorMessage;

    return AuthPageScaffold(
      title: AppStrings.createYourAccount,
      subtitle: AppStrings.startCreatingSubtitle,
      formChild: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GoogleSignInButton(onPressed: _handleGoogleSignIn),
          SizedBox(height: AppDimens.sdp(context, '_20sdp')),
          const OrDivider(),
          SizedBox(height: AppDimens.sdp(context, '_20sdp')),
          if (errorMessage != null) ...[
            InlineErrorBanner(message: errorMessage),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          ],
          const FieldLabel(AppStrings.fullName),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
          AuthTextField(
            controller: _fullNameController,
            hint: AppStrings.enterYourFullName,
            prefixIconAsset: AppAssets.profileIcon,
            keyboardType: TextInputType.name,
          ),
          SizedBox(height: AppDimens.sdp(context, '_20sdp')),
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
          SizedBox(height: AppDimens.sdp(context, '_20sdp')),
          const FieldLabel(AppStrings.confirmPassword),
          SizedBox(height: AppDimens.sdp(context, '_8sdp')),
          AuthTextField(
            controller: _confirmPasswordController,
            hint: AppStrings.reEnterYourPassword,
            prefixIconAsset: AppAssets.lockIcon,
            obscureText: _obscureConfirmPassword,
            suffixIcon: IconButton(
              splashRadius: 20,
              icon: Icon(
                _obscureConfirmPassword
                    ? Icons.visibility_off_outlined
                    : Icons.visibility_outlined,
                color: AppColors.textSecondary,
                size: AppDimens.sdp(context, '_20sdp'),
              ),
              onPressed: () {
                setState(() {
                  _obscureConfirmPassword = !_obscureConfirmPassword;
                });
              },
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_24sdp')),
          GradientButton(
            label: AppStrings.createAccount,
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
                  AppStrings.alreadyHaveAccount,
                  style: AppTextStyles.regular.copyWith(
                    color: AppColors.textSecondary,
                    fontSize: AppDimens.ssp(context, '_13ssp'),
                  ),
                ),
                GestureDetector(
                  onTap: () => Navigator.of(context).pop(),
                  child: Text(
                    AppStrings.signIn,
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
