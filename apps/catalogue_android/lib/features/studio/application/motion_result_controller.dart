import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/job_row.dart';
import 'studio_providers.dart';
import 'studio_reference_providers.dart';

class MotionResultController extends AsyncNotifier<JobRow> {
  MotionResultController(this.jobId);

  final String jobId;
  Timer? _pollTimer;

  @override
  Future<JobRow> build() async {
    ref.onDispose(() => _pollTimer?.cancel());
    final job = await ref.read(studioRepositoryProvider).getJob(jobId);
    if (!job.isTerminal) _schedulePoll();
    return job;
  }

  void _schedulePoll() {
    _pollTimer?.cancel();
    _pollTimer = Timer(const Duration(seconds: 2), () async {
      try {
        final job = await ref.read(studioRepositoryProvider).getJob(jobId);
        state = AsyncData(job);
        if (!job.isTerminal) {
          _schedulePoll();
        } else {
          // A failed job is refunded server-side — pick up the new balance.
          ref.invalidate(creditsSummaryProvider);
        }
      } catch (_) {
        _schedulePoll();
      }
    });
  }

  Future<String> resultVideoUrl() async {
    final presigned = await ref.read(studioRepositoryProvider).jobResult(jobId);
    return presigned.url;
  }

  Future<String> download() async {
    final presigned = await ref
        .read(studioRepositoryProvider)
        .downloadJob(jobId);
    return presigned.url;
  }
}

final motionResultControllerProvider = AsyncNotifierProvider.autoDispose
    .family<MotionResultController, JobRow, String>(MotionResultController.new);
