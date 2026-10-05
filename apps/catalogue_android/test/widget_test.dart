import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aicatalogueflutter/app/theme/app_theme.dart';
import 'package:aicatalogueflutter/views/login_page.dart';
import 'package:aicatalogueflutter/views/onboarding_page.dart';

void main() {
  testWidgets('OnboardingPage renders the first slide', (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(child: MaterialApp(home: OnboardingPage())),
    );

    expect(find.text('Replace the photoshoot'), findsOneWidget);
    expect(find.text('Skip'), findsOneWidget);
  });

  testWidgets('LoginPage renders its key fields and actions',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light,
          home: const LoginPage(),
        ),
      ),
    );

    expect(find.text('Welcome Back!'), findsOneWidget);
    expect(find.text('Continue with google'), findsOneWidget);
    expect(find.text('Enter your email'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);

    expect(find.byIcon(Icons.visibility_off_outlined), findsOneWidget);
    await tester.tap(find.byIcon(Icons.visibility_off_outlined));
    await tester.pump();
    expect(find.byIcon(Icons.visibility_outlined), findsOneWidget);
  });
}
