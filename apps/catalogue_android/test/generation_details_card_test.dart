import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:aicatalogueflutter/widgets/detail_page_widgets.dart';

void main() {
  for (final size in const [
    Size(320, 640),
    Size(360, 740),
    Size(411, 860),
    Size(600, 960),
    Size(800, 1200),
  ]) {
    testWidgets('GenerationDetailsCard has no overflow at ${size.width}', (
      tester,
    ) async {
      tester.view.physicalSize = size;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ListView(
              padding: const EdgeInsets.all(16),
              children: const [
                GenerationDetailsCard(
                  heading: 'Generation Details:',
                  thumbnailIcon: Icons.image,
                  thumbnailTint: Colors.pink,
                  promptLabel: 'Prompt',
                  promptText: null,
                  duration: '10 Seconds',
                  aspectRatio: '9:16 (Portrait)',
                  outputQuality: '2K',
                  creditsUsed: '200 Credits',
                  generatedOn: '06 Aug 2026 at 5:15 PM',
                ),
              ],
            ),
          ),
        ),
      );
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  }
}
