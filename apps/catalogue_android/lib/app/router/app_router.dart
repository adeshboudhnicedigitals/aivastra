import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/providers/core_providers.dart';
import '../../features/auth/application/auth_controller.dart';
import '../../features/auth/application/auth_state.dart';
import '../../views/contact_us_page.dart';
import '../../views/credit_history_page.dart';
import '../../views/forgot_password_page.dart';
import '../../views/home_page.dart';
import '../../views/invoices_page.dart';
import '../../views/login_page.dart';
import '../../views/onboarding_page.dart';
import '../../views/plans_billing_page.dart';
import '../../views/profile_preferences_page.dart';
import '../../views/reset_password_page.dart';
import '../../views/signup_page.dart';
import '../../views/splash_page.dart';
import '../../views/tutorials_page.dart';
import '../../views/verify_email_pending_page.dart';
import '../app_routes.dart';
import 'router_refresh_notifier.dart';
import 'splash_hold_provider.dart';

const _unauthenticatedRoutes = {
  AppRoutes.onboarding,
  AppRoutes.login,
  AppRoutes.signup,
  AppRoutes.verifyEmailPending,
  AppRoutes.forgotPassword,
  AppRoutes.resetPassword,
};

/// Drops keyboard focus whenever a page is pushed. Without it, a focused
/// search field is remembered by the page underneath and gets focus (keyboard
/// and cursor) back the moment you return from an item you opened from the
/// results.
class _DismissKeyboardObserver extends NavigatorObserver {
  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) {
    FocusManager.instance.primaryFocus?.unfocus();
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    observers: [_DismissKeyboardObserver()],
    initialLocation: AppRoutes.splash,
    refreshListenable: RouterRefreshNotifier(ref),
    redirect: (context, state) {
      final authState = ref.read(authControllerProvider);
      final location = state.matchedLocation;

      // Hold on Splash for its minimum reveal time regardless of how fast
      // auth resolves — see splashHoldProvider's own doc comment.
      if (location == AppRoutes.splash && !ref.read(splashHoldProvider)) {
        return null;
      }

      if (authState.status == AuthStatus.unknown) {
        return location == AppRoutes.splash ? null : AppRoutes.splash;
      }

      final isAuthRoute = _unauthenticatedRoutes.contains(location);

      if (authState.status == AuthStatus.unauthenticated) {
        if (isAuthRoute) return null;
        // First-run gate: an unauthenticated visitor who hasn't seen
        // onboarding yet (fresh install, or one that never finished it) goes
        // there instead of straight to Login. onboarding_page.dart marks it
        // seen (`setOnboardingSeen`) the moment it hands off to Login/Signup,
        // so this only fires once per install.
        final onboardingSeen = ref.read(localPrefsProvider).onboardingSeen;
        return onboardingSeen ? AppRoutes.login : AppRoutes.onboarding;
      }

      // Authenticated.
      if (location == AppRoutes.splash || isAuthRoute) {
        return AppRoutes.home;
      }
      return null;
    },
    routes: [
      GoRoute(path: AppRoutes.splash, builder: (_, _) => const SplashPage()),
      GoRoute(
        path: AppRoutes.onboarding,
        builder: (_, _) => const OnboardingPage(),
      ),
      GoRoute(path: AppRoutes.login, builder: (_, _) => const LoginPage()),
      GoRoute(path: AppRoutes.signup, builder: (_, _) => const SignupPage()),
      GoRoute(
        path: AppRoutes.verifyEmailPending,
        builder: (_, state) => VerifyEmailPendingPage(
          email: state.uri.queryParameters['email'] ?? '',
        ),
      ),
      GoRoute(
        path: AppRoutes.forgotPassword,
        builder: (_, _) => const ForgotPasswordPage(),
      ),
      GoRoute(
        path: AppRoutes.resetPassword,
        builder: (_, state) =>
            ResetPasswordPage(initialToken: state.uri.queryParameters['token']),
      ),
      GoRoute(path: AppRoutes.home, builder: (_, _) => const HomePage()),
      GoRoute(
        path: AppRoutes.profilePreferences,
        builder: (_, _) => const ProfilePreferencesPage(),
      ),
      GoRoute(
        path: AppRoutes.plansBilling,
        builder: (_, _) => const PlansBillingPage(),
      ),
      GoRoute(
        path: AppRoutes.creditHistory,
        builder: (_, _) => const CreditHistoryPage(),
      ),
      GoRoute(
        path: AppRoutes.invoices,
        builder: (_, _) => const InvoicesPage(),
      ),
      GoRoute(
        path: AppRoutes.tutorials,
        builder: (_, _) => const TutorialsPage(),
      ),
      GoRoute(
        path: AppRoutes.contactUs,
        builder: (_, _) => const ContactUsPage(),
      ),
    ],
  );
});
