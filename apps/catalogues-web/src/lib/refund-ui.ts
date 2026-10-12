/**
 * Customer-facing copy for a refund request's state. Shared by the Studio panel and the
 * catalogue detail page so the wording lives in one place.
 */
export function refundChipText(request: {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  adminNote: string | null;
}): string {
  if (request.status === 'PENDING') return 'Refund requested — under review (2-3 business hours)';
  if (request.status === 'APPROVED') return 'Refund approved — credits returned';
  return `Refund declined${request.adminNote ? `: ${request.adminNote}` : ''}`;
}
