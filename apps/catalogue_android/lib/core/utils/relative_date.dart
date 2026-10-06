/// Formatting/bucketing helpers shared by the My Creations and Products
/// grids, which group and filter real `createdAt`/`uploadedAt` timestamps
/// from the API instead of the hardcoded date strings the mock data used.
library;

import '../../utils/app_strings.dart';

const _months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', //
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const _fullMonths = [
  'January', 'February', 'March', 'April', 'May', 'June', //
  'July', 'August', 'September', 'October', 'November', 'December',
];

/// Parses an ISO-8601 timestamp from the API into local time. Falls back to
/// "now" for a malformed value rather than throwing, since this only ever
/// feeds display grouping/filtering.
DateTime parseApiDate(String iso) =>
    DateTime.tryParse(iso)?.toLocal() ?? DateTime.now();

/// e.g. "Aug 25, 2026" — the section header a list is grouped under.
String formatDateGroup(DateTime dt) =>
    '${_months[dt.month - 1]} ${dt.day}, ${dt.year}';

/// e.g. "August 06, 2026 at 5:15 PM" — a "Generated On" value, in place of
/// the raw ISO timestamp the API returns.
String formatGeneratedOn(String iso) {
  final dt = parseApiDate(iso);
  final hour12 = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  final minute = dt.minute.toString().padLeft(2, '0');
  final period = dt.hour < 12 ? 'AM' : 'PM';
  final day = dt.day.toString().padLeft(2, '0');
  return '${_fullMonths[dt.month - 1]} $day, ${dt.year} at $hour12:$minute $period';
}

/// e.g. "0:08" — a whole-seconds video duration (PixVerse jobs are always
/// under a minute, so this never needs an hours segment).
String formatVideoDuration(int seconds) {
  final minutes = seconds ~/ 60;
  final remainingSeconds = (seconds % 60).toString().padLeft(2, '0');
  return '$minutes:$remainingSeconds';
}

/// e.g. "2h ago", "5d ago", "3w ago".
String formatTimeAgo(DateTime dt) {
  final diff = DateTime.now().difference(dt);
  if (diff.inSeconds < 60) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  if (diff.inDays < 30) return '${(diff.inDays / 7).floor()}w ago';
  if (diff.inDays < 365) return '${(diff.inDays / 30).floor()}mo ago';
  return '${(diff.inDays / 365).floor()}y ago';
}

bool _isSameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

/// Whether [dt] falls inside the Created-On filter sheet's [bucket]
/// selection. [AppStrings.filterCustomDate] has no date-range picker wired
/// up yet, so it matches everything rather than nothing.
bool matchesCreatedOnBucket(String bucket, DateTime dt) {
  final now = DateTime.now();
  switch (bucket) {
    case AppStrings.filterToday:
      return _isSameDay(dt, now);
    case AppStrings.filterYesterday:
      return _isSameDay(dt, now.subtract(const Duration(days: 1)));
    case AppStrings.filterThisWeek:
      return now.difference(dt).inDays < 7;
    case AppStrings.filterThisMonth:
      return dt.year == now.year && dt.month == now.month;
    case AppStrings.filterCreatedAll:
    case AppStrings.filterCustomDate:
    default:
      return true;
  }
}
