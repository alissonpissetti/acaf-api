export enum CashEntryStatus {
  PENDING = 'pending',
  SETTLED = 'settled',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

export function effectiveCashEntryStatus(
  status: CashEntryStatus,
  dueDate: string | Date,
  settledAt: Date | null,
): CashEntryStatus {
  if (status === CashEntryStatus.CANCELLED) return CashEntryStatus.CANCELLED;
  if (status === CashEntryStatus.SETTLED || settledAt) return CashEntryStatus.SETTLED;
  const due = typeof dueDate === 'string' ? new Date(`${dueDate}T12:00:00`) : new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  if (due < today) return CashEntryStatus.OVERDUE;
  return CashEntryStatus.PENDING;
}
