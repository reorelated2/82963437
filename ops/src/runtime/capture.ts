export interface FieldOrderState {
  inspectionComplete: boolean;
  submitted: boolean;
  qualityAccepted: boolean;
  invoiced: boolean;
  paymentTermsDays: number | null;
  invoicedAt: string | null;
  paymentReceivedAt: string | null;
}

export interface FieldOrderStatus {
  completion: 'complete' | 'open';
  submission: 'submitted' | 'not_submitted';
  quality: 'accepted' | 'pending';
  invoicing: 'invoiced' | 'not_invoiced';
  payment: 'received' | 'due' | 'overdue' | 'terms_unknown' | 'not_invoiced';
  collectedRevenue: boolean;
  summary: string;
}

export function fieldOrderStatus(state: FieldOrderState, now: Date): FieldOrderStatus {
  const completion = state.inspectionComplete ? 'complete' : 'open';
  const submission = state.submitted ? 'submitted' : 'not_submitted';
  const quality = state.qualityAccepted ? 'accepted' : 'pending';
  const invoicing = state.invoiced ? 'invoiced' : 'not_invoiced';
  let payment: FieldOrderStatus['payment'] = 'not_invoiced';
  if (state.paymentReceivedAt) payment = 'received';
  else if (state.invoiced) {
    if (state.paymentTermsDays === null || !state.invoicedAt) payment = 'terms_unknown';
    else {
      const due = new Date(state.invoicedAt).getTime() + state.paymentTermsDays * 24 * 60 * 60 * 1000;
      payment = now.getTime() > due ? 'overdue' : 'due';
    }
  }
  const collectedRevenue = payment === 'received';
  const summary = collectedRevenue
    ? 'Payment received.'
    : `Inspection ${completion}. Invoice ${invoicing}. Payment ${payment.replace('_', ' ')}. Not collected revenue.`;
  return { completion, submission, quality, invoicing, payment, collectedRevenue, summary };
}
