import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aicatalogueflutter/widgets/app_refresh_scroll_view.dart';

Widget _host(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('pulling down on a page shorter than the screen refreshes', (
    tester,
  ) async {
    var calls = 0;
    await tester.pumpWidget(
      _host(
        AppRefreshScrollView(
          onRefresh: () async => calls++,
          child: const SizedBox(height: 100, child: Text('short page')),
        ),
      ),
    );

    await tester.fling(find.text('short page'), const Offset(0, 300), 1000);
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.pumpAndSettle();

    expect(calls, 1);
  });

  testWidgets('a failing refresh completes instead of throwing', (tester) async {
    await tester.pumpWidget(
      _host(
        AppRefreshScrollView(
          onRefresh: () async => throw StateError('network down'),
          child: const SizedBox(height: 100, child: Text('page')),
        ),
      ),
    );

    await tester.fling(find.text('page'), const Offset(0, 300), 1000);
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(RefreshProgressIndicator), findsNothing);
  });

  test('awaitQuietly swallows the error but still waits', () async {
    var finished = false;
    await awaitQuietly(
      Future<void>.delayed(const Duration(milliseconds: 10)).then((_) {
        finished = true;
        throw StateError('boom');
      }),
    );
    expect(finished, isTrue);
  });
}
