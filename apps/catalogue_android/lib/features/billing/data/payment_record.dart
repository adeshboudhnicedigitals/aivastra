/// One row of `GET /v1/payments/history` - a credit-pack purchase attempt and
/// its invoice, if one was issued.
class PaymentRecord {
  const PaymentRecord({
    required this.id,
    required this.status,
    required this.totalPaise,
    required this.createdAt,
    this.planName,
    this.planId,
    this.paidAt,
    this.invoiceNumber,
    this.invoiceUrl,
  });

  factory PaymentRecord.fromJson(Map<String, dynamic> json) => PaymentRecord(
    id: '${json['id'] ?? ''}',
    status: '${json['status'] ?? ''}',
    totalPaise: (json['totalPaise'] as num?)?.toInt() ?? 0,
    createdAt: '${json['createdAt'] ?? ''}',
    planName: json['planName'] as String?,
    planId: json['planId'] as String?,
    paidAt: json['paidAt'] as String?,
    invoiceNumber: json['invoiceNumber'] as String?,
    invoiceUrl: json['invoiceUrl'] as String?,
  );

  final String id;

  /// `paid`, `created` (started, not completed) or `failed`.
  final String status;

  /// Amount charged including GST.
  final int totalPaise;
  final String createdAt;
  final String? planName;
  final String? planId;
  final String? paidAt;
  final String? invoiceNumber;

  /// Presigned PDF link (valid for an hour), when an invoice exists.
  final String? invoiceUrl;

  bool get isPaid => status == 'paid';
  bool get isFailed => status == 'failed';

  /// When it happened: the payment time once paid, else when it was started.
  DateTime get when =>
      DateTime.tryParse(paidAt ?? createdAt)?.toLocal() ?? DateTime(1970);
}
