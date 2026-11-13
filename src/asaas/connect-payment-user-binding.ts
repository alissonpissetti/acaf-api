import type { ConnectMemberRecord } from '../partner/types';
import { normalizeHolderKey } from '../partner/checkIn';
import { isPlatformUserUuid } from './connect-checkout-identity';

export type ConnectPaymentUserBinding = {
  holderName: string;
  holderKey: string;
  platformUserId: string | null;
  cpf: string | null;
  mobilePhone: string | null;
  companyName: string | null;
};

export function bindConnectPaymentUserFromMember(
  holderName: string,
  holderKey: string,
  member?: ConnectMemberRecord | null,
): ConnectPaymentUserBinding {
  const key = holderKey.trim().toLowerCase();
  return {
    holderName: member?.holderName?.trim() || holderName.trim(),
    holderKey: key,
    platformUserId: member?.userId?.trim() && isPlatformUserUuid(member.userId) ? member.userId.trim() : null,
    cpf: member?.holderCpf?.trim() || null,
    mobilePhone: member?.holderPhone?.trim() || null,
    companyName: member?.companyName?.trim() || null,
  };
}

export function findConnectMemberForPayment(
  members: ConnectMemberRecord[] | undefined,
  holderName: string,
  holderKey: string,
): ConnectMemberRecord | undefined {
  const key = holderKey.trim().toLowerCase();
  if (!members?.length) return undefined;
  return (
    members.find((m) => m.holderKey === key) ??
    members.find((m) => normalizeHolderKey(m.holderName) === key)
  );
}
