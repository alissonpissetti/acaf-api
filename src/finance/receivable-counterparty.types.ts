export type ReceivablePayerKind = 'client' | 'company' | 'partner';

export type ReceivableAttachmentKind = 'general' | 'payment_receipt';

export type ReceivableAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  publicUrl: string;
  uploadedAt: string;
  kind?: ReceivableAttachmentKind;
  recordedSettledAt?: string | null;
};

export type ReceivablePayerRef = {
  kind: ReceivablePayerKind;
  refId: string;
};

export function buildPayerKey(kind: ReceivablePayerKind, refId: string): string {
  return `${kind}:${refId}`;
}

export function parsePayerKey(key: string | null | undefined): ReceivablePayerRef | null {
  if (!key) return null;
  const [kind, ...rest] = key.split(':');
  const refId = rest.join(':');
  if ((kind === 'client' || kind === 'company' || kind === 'partner') && refId) {
    return { kind, refId };
  }
  return null;
}

export function payerKindLabel(kind: ReceivablePayerKind | null | undefined): string {
  if (kind === 'company') return 'Empresa';
  if (kind === 'partner') return 'Parceiro';
  if (kind === 'client') return 'Cliente';
  return 'Pagador';
}
