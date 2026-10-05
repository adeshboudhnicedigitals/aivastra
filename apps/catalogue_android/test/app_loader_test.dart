import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aicatalogueflutter/app/theme/app_colors.dart';
import 'package:aicatalogueflutter/widgets/app_loader.dart';
import 'package:aicatalogueflutter/widgets/gradient_button.dart';

Widget _host(Widget child) => MaterialApp(home: Scaffold(body: child));

/// [AppLoader] draws two stacked indicators — a full, faint track (pinned at
/// 100%) and the moving arc on top of it — so the spinner reads as a dial,
/// not a lone floating line. Index 1 is the moving (foreground) arc.
Color? _foregroundColorOf(WidgetTester tester) {
  final indicator = tester.widgetList<CircularProgressIndicator>(
    find.byType(CircularProgressIndicator),
  ).elementAt(1);
  return (indicator.valueColor as AlwaysStoppedAnimation<Color?>).value;
}

void main() {
  testWidgets('the default loader is a centred pink spinner with a full track', (
    tester,
  ) async {
    await tester.pumpWidget(_host(const AppLoader()));

    expect(find.byType(CircularProgressIndicator), findsNWidgets(2));
    expect(_foregroundColorOf(tester), AppColors.pinkGradientStart);
    final centre = tester
        .getCenter(find.byType(CircularProgressIndicator).first);
    expect(centre, tester.getCenter(find.byType(Scaffold)));
  });

  testWidgets('the section loader adds vertical space around the spinner', (
    tester,
  ) async {
    await tester.pumpWidget(_host(const AppLoader.section()));
    final plain = await _height(tester, const AppLoader());
    final section = await _height(tester, const AppLoader.section());
    expect(section, greaterThan(plain));
  });

  testWidgets('the button loader is white and not centred', (tester) async {
    await tester.pumpWidget(
      _host(const Align(alignment: Alignment.topLeft, child: AppLoader.button())),
    );

    expect(_foregroundColorOf(tester), Colors.white);
    final topLeft = tester
        .getTopLeft(find.byType(CircularProgressIndicator).first);
    expect(topLeft, Offset.zero);
  });

  testWidgets('a loading GradientButton shows the spinner and ignores taps', (
    tester,
  ) async {
    var taps = 0;
    await tester.pumpWidget(
      _host(
        Center(
          child: GradientButton(
            label: 'Continue',
            isLoading: true,
            onPressed: () => taps++,
          ),
        ),
      ),
    );

    expect(find.byType(AppLoader), findsOneWidget);
    expect(find.text('Continue'), findsNothing);
    await tester.tap(find.byType(GradientButton));
    expect(taps, 0);
  });

  testWidgets('an idle GradientButton shows its label, not the spinner', (
    tester,
  ) async {
    await tester.pumpWidget(
      _host(Center(child: GradientButton(label: 'Continue', onPressed: () {}))),
    );

    expect(find.text('Continue'), findsOneWidget);
    expect(find.byType(AppLoader), findsNothing);
  });
}

Future<double> _height(WidgetTester tester, Widget loader) async {
  await tester.pumpWidget(
    _host(Column(mainAxisSize: MainAxisSize.min, children: [loader])),
  );
  return tester.getSize(find.byType(Column)).height;
}
