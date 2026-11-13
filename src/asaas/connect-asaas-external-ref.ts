/** Sufixo estável em externalReference do Asaas para carregar userId da plataforma. */
export const CONNECT_ASAAS_USER_REF_SUFFIX = '#u=';

export function buildConnectAsaasCustomerExternalReference(holderKey: string, userId: string): string {
  const key = holderKey.trim().toLowerCase();
  const id = userId.trim();
  if (!key || !id) return key;
  return `${key}${CONNECT_ASAAS_USER_REF_SUFFIX}${id}`;
}

export function stripConnectAsaasUserRefSuffix(externalReference: string): string {
  const ref = externalReference.trim();
  const idx = ref.indexOf(CONNECT_ASAAS_USER_REF_SUFFIX);
  if (idx < 0) return ref;
  return ref.slice(0, idx);
}

export function parseConnectAsaasUserIdFromReference(
  externalReference: string | null | undefined,
): string | null {
  const ref = externalReference?.trim() ?? '';
  const idx = ref.indexOf(CONNECT_ASAAS_USER_REF_SUFFIX);
  if (idx < 0) return null;
  const id = ref.slice(idx + CONNECT_ASAAS_USER_REF_SUFFIX.length).trim();
  return id.length > 0 ? id : null;
}

export function buildConnectAsaasPaymentExternalReference(
  baseReference: string,
  userId?: string | null,
): string {
  const base = baseReference.trim();
  const id = userId?.trim();
  if (!base || !id) return base;
  return `${base}${CONNECT_ASAAS_USER_REF_SUFFIX}${id}`;
}
