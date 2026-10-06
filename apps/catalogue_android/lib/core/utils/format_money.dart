/// Rupees with Indian digit grouping (12,34,567), e.g. `₹1,000`.
String formatInr(int rupees) {
  final digits = rupees.abs().toString();
  final sign = rupees < 0 ? '-' : '';
  if (digits.length <= 3) return '$sign₹$digits';
  final head = digits.substring(0, digits.length - 3);
  final tail = digits.substring(digits.length - 3);
  final grouped = head.replaceAllMapped(
    RegExp(r'(\d)(?=(\d\d)+$)'),
    (m) => '${m[1]},',
  );
  return '$sign₹$grouped,$tail';
}

/// An amount in paise as rupees: whole rupees drop the decimals
/// (`₹1,180`), anything else keeps two (`₹1,180.50`).
String formatPaise(int paise) {
  final rupees = paise ~/ 100;
  final rest = paise.abs() % 100;
  if (rest == 0) return formatInr(rupees);
  return '${formatInr(rupees)}.${rest.toString().padLeft(2, '0')}';
}
