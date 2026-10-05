import 'dart:async';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/models/catalogue_detail.dart';
import '../data/models/job_row.dart';
import 'studio_providers.dart';
import 'studio_reference_providers.dart';

/// Loads a catalogue's detail and, while any of its jobs are still
/// non-terminal, re-fetches every few seconds until they finish — a
/// self-scheduling poll rather than an indefinite stream, so it naturally
/// stops calling the API once generation completes.
///
/// A regenerated image is a brand-new job that the catalogue-detail endpoint
/// does NOT list (the server doesn't attach it to the catalogue), so — like
/// the web app, which swaps the slot's job id in place — this keeps a
/// slot → replacement-job map and substitutes the replacement into every
/// detail it loads.
class CatalogueResultController extends AsyncNotifier<CatalogueDetail> {
  CatalogueResultController(this.catalogueId);

  final String catalogueId;
  Timer? _pollTimer;

  /// Original job id (the slot in the detail) → the job currently shown there.
  final Map<String, String> _slotCurrent = {};

  /// Latest known state of each replacement job, by id.
  final Map<String, JobRow> _replacementRows = {};

  /// Jobs downloaded this session. The server stamps them on download and
  /// then refuses to regenerate them, but a substituted job's row (a plain
  /// `GET /v1/jobs/:id`) doesn't carry that flag, so track it here.
  final Set<String> _downloaded = {};

  @override
  Future<CatalogueDetail> build() async {
    ref.onDispose(() => _pollTimer?.cancel());
    final detail = await _load();
    if (!detail.allJobsTerminal) _schedulePoll();
    return detail;
  }

  Future<CatalogueDetail> _load() async {
    final repository = ref.read(studioRepositoryProvider);
    final detail = await repository.catalogueDetail(catalogueId);

    for (final current in _slotCurrent.values) {
      final known = _replacementRows[current];
      if (known == null || !known.isTerminal) {
        try {
          _replacementRows[current] = await repository.getJob(current);
        } catch (_) {
          // Keep the last known row; the next poll tries again.
        }
      }
    }

    return detail.copyWith(
      jobs: [
        for (final job in detail.jobs)
          _withDownloaded(_replacementRows[_slotCurrent[job.id]] ?? job),
      ],
    );
  }

  JobRow _withDownloaded(JobRow job) => _downloaded.contains(job.id)
      ? job.copyWith(alreadyDownloaded: true)
      : job;

  void _schedulePoll() {
    _pollTimer?.cancel();
    _pollTimer = Timer(const Duration(seconds: 2), () async {
      try {
        final detail = await _load();
        state = AsyncData(detail);
        if (!detail.allJobsTerminal) {
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

  Future<String> download(String jobId) async {
    final presigned = await ref
        .read(studioRepositoryProvider)
        .downloadJob(jobId);
    // The server has now stamped this job as downloaded (and will refuse to
    // regenerate it) — reflect that without another round trip.
    _downloaded.add(jobId);
    final detail = state.value;
    if (detail != null) {
      state = AsyncData(
        detail.copyWith(
          jobs: [for (final j in detail.jobs) _withDownloaded(j)],
        ),
      );
    }
    return presigned.url;
  }

  Future<List<String>> regenerateReasons(String jobId) =>
      ref.read(studioRepositoryProvider).regenerateReasons(jobId);

  Future<void> regenerate(String jobId, String reason) async {
    // One key per confirmed tap — same as the web app.
    final key =
        '${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';
    final newJobId = await ref
        .read(studioRepositoryProvider)
        .regenerate(jobId, reason, idempotencyKey: key);

    // Regenerating an already-regenerated image keeps the same slot.
    final slot =
        _slotCurrent.entries
            .where((e) => e.value == jobId)
            .map((e) => e.key)
            .firstOrNull ??
        jobId;
    _slotCurrent[slot] = newJobId;
    _replacementRows[newJobId] = JobRow(
      id: newJobId,
      status: 'QUEUED',
      createdAt: DateTime.now().toUtc().toIso8601String(),
    );

    final detail = await _load();
    state = AsyncData(detail);
    if (!detail.allJobsTerminal) _schedulePoll();
  }

  /// Deletes one look (job) from this catalogue. A failure of the delete call
  /// itself (e.g. the job is still generating) propagates to the caller.
  /// Returns whether the catalogue still has images afterwards - false when
  /// that was its last job, so there is nothing to re-fetch or show.
  Future<bool> deleteJob(String jobId) async {
    await ref.read(studioRepositoryProvider).deleteJob(jobId);
    _slotCurrent.removeWhere((slot, current) => current == jobId);
    _replacementRows.remove(jobId);
    try {
      final detail = await _load();
      state = AsyncData(detail);
      if (!detail.allJobsTerminal) _schedulePoll();
      return detail.jobs.isNotEmpty;
    } catch (_) {
      return false;
    }
  }
}

final catalogueResultControllerProvider = AsyncNotifierProvider.autoDispose
    .family<CatalogueResultController, CatalogueDetail, String>(
      CatalogueResultController.new,
    );
