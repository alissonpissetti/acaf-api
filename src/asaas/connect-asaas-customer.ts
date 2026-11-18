import type { ConfigService } from '@nestjs/config';
import { normalizeHolderKey } from '../partner/checkIn';
import { setConnectMemberAsaasCustomerId } from '../partner/connectMember';
import type { ConnectMemberRecord } from '../partner/types';
import type { AsaasClient } from './asaas.client';
import { buildConnectAsaasCustomerExternalReference } from './connect-asaas-external-ref';
import { connectFallbackMemberEmail } from './connect-checkout-identity';
import { resolveConnectCheckoutCpf, resolveHolderPhone } from './connect-card-input';

export type ResolveConnectAsaasCustomerInput = {
  holderCpf?: string;
  holderEmail?: string;
  holderPhone?: string;
  platformUserId?: string;
};

/** Garante customer Asaas vinculado ao titular Movly (persiste `asaasCustomerId` no membro). */
export async function resolveConnectAsaasCustomerId(
  asaas: AsaasClient,
  config: ConfigService,
  member: ConnectMemberRecord,
  holderName: string,
  input: ResolveConnectAsaasCustomerInput,
): Promise<string> {
  const existing = member.asaasCustomerId?.trim();
  if (existing) return existing;

  const holderKey = normalizeHolderKey(holderName);
  const platformUserId = input.platformUserId?.trim() || member.userId?.trim() || '';
  const cpfCnpj = resolveConnectCheckoutCpf(input.holderCpf ?? member.holderCpf, config);
  const email = input.holderEmail?.trim() || member.holderEmail?.trim() || connectFallbackMemberEmail(holderName);
  const phone = resolveHolderPhone(input.holderPhone ?? member.holderPhone, config);

  const customerExternalRef = platformUserId
    ? buildConnectAsaasCustomerExternalReference(holderKey, platformUserId)
    : holderKey;

  let customer =
    (await asaas.findCustomerByExternalReference(customerExternalRef)) ??
    (await asaas.findCustomerByExternalReference(holderKey));

  if (!customer) {
    customer = await asaas.createCustomer({
      name: holderName,
      cpfCnpj,
      email,
      phone,
      externalReference: customerExternalRef,
    });
  } else if (platformUserId && customer.externalReference?.trim() !== customerExternalRef) {
    customer = await asaas.updateCustomer(customer.id, {
      externalReference: customerExternalRef,
      name: holderName,
      email,
    });
  }

  setConnectMemberAsaasCustomerId(holderName, customer.id);
  return customer.id;
}