import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/app_routes.dart';
import '../app/theme/app_colors.dart';
import '../app/theme/app_dimens.dart';
import '../app/theme/app_text_styles.dart';
import '../features/auth/application/verify_email_pending_view_model.dart';
import '../widgets/auth_widgets.dart';
import '../widgets/gradient_button.dart';

class VerifyEmailPendingPage extends ConsumerWidget {
  const VerifyEmailPendingPage({super.key, required this.email});

  final String email;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(verifyEmailPendingViewModelProvider);
    final viewModel = ref.read(verifyEmailPendingViewModelProvider.notifier);

    return AuthPageScaffold(
      title: 'Check your email',
      subtitle: "We've sent a verification link to $email",
      formChild: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Icon(
            Icons.mark_email_unread_outlined,
            color: AppColors.pinkGradientStart,
            size: AppDimens.sdp(context, '_60sdp'),
          ),
          SizedBox(height: AppDimens.sdp(context, '_24sdp')),
          Text(
            'Tap the link in the email to verify your account, then come '
            'back and log in.',
            textAlign: TextAlign.center,
            style: AppTextStyles.regular.copyWith(
              color: AppColors.textSecondary,
              fontSize: AppDimens.ssp(context, '_14ssp'),
            ),
          ),
          SizedBox(height: AppDimens.sdp(context, '_20sdp')),
          if (state.errorMessage != null) ...[
            InlineErrorBanner(message: state.errorMessage!),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          ] else if (state.justSent) ...[
            Text(
              'Verification email sent.',
              textAlign: TextAlign.center,
              style: AppTextStyles.medium.copyWith(
                color: AppColors.success,
                fontSize: AppDimens.ssp(context, '_13ssp'),
              ),
            ),
            SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          ],
          GradientButton(
            label: 'Resend Email',
            isLoading: state.isSending,
            onPressed: () => viewModel.resend(email),
          ),
          SizedBox(height: AppDimens.sdp(context, '_16sdp')),
          Center(
            child: GestureDetector(
              onTap: () => context.go(AppRoutes.login),
              child: Text(
                'Already verified? Log In',
                style: AppTextStyles.semiBold.copyWith(
                  color: AppColors.pinkGradientStart,
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
