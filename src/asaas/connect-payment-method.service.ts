import { BadRequestException, Inject, Injectable, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ensureConnectMemberForPlatformUser,
  findConnectMember,
  findConnectMemberByUserId,
  findConnectSavedPaymentMethod,
  getConnectMemberProfile,
  removeConnectSavedPaymentMethod,
  setConnectSavedPaymentMethodDefault,
  upsertConnectSavedPaymentMethod,
  type ConnectMemberProfile,
} from '../partner/connectMember';
import { loadStore } from '../partner/store';
import { connectFallbackMemberEmail } from './connect-checkout-identity';
import { AsaasClient } from './asaas.client';
import {
  buildCreditCardHolderInfo,
  parseConnectCardInput,
  resolveAsaasRemoteIp,
  resolveConnectCheckoutCpf,
  resolveHolderPhone,
} from './connect-card-input';
import { resolveConnectAsaasCustomerId } from './connect-asaas-customer';
import { UsersService } from '../users/users.service';

export type ConnectPaymentMethodCardInput = {
  holderName: string;
  number: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
  brand?: string;
};

export type AddConnectPaymentMethodInput = {
  holderName: string;
  holderCpf?: string;
  holderEmail?: string;
  holderPhone?: string;
  platformUserId?: string;
  remoteIp?: string;
  card: ConnectPaymentMethodCardInput;
  /** Atualiza cobrança recorrente da assinatura Movly no Asaas. */
  useForSubscription?: boolean;
};

export type SetDefaultConnectPaymentMethodInput = {
  holderName: string;
  paymentMethodId: string;
  platformUserId?: string;
  holderCpf?: string;
  holderEmail?: string;
  holderPhone?: string;
  remoteIp?: string;
  /** Atualiza cobrança recorrente no Asaas. Padrão: só define principal na carteira. */
  applyToSubscription?: boolean;
  /**
   * Fallback quando o cartão não tem `asaasToken` (cadastro anterior à tokenização).
   * Com token armazenado, PATCH não exige PAN/CVV — ver `PUT …/subscriptions/{id}/creditCard`.
   */
  card?: ConnectPaymentMethodCardInput;
};

@Injectable()
export class ConnectPaymentMethodService {
  constructor(
    private readonly asaas: AsaasClient,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  async addPaymentMethod(input: AddConnectPaymentMethodInput): Promise<ConnectMemberProfile> {
    const holderName = input.holderName.trim();
    if (!holderName) {
      throw new BadRequestException('Informe o nome do titular.');
    }
    const platformUserId = input.platformUserId?.trim();
    if (!platformUserId) {
      throw new BadRequestException('Faça login para salvar cartões na sua conta.');
    }

    const member = await this.resolveMemberForPayment(holderName, platformUserId);
    const parsed = parseConnectCardInput({
      holderName: input.card.holderName,
      number: input.card.number,
      expiryMonth: input.card.expiryMonth,
      expiryYear: input.card.expiryYear,
      cvv: input.card.cvv,
      brandHint: input.card.brand,
    });

    const useForSubscription = input.useForSubscription ?? Boolean(member?.active && member.asaasSubscriptionId);
    const remoteIp = resolveAsaasRemoteIp(this.config, input.remoteIp);

    if (!this.asaas.isConfigured()) {
      throw new BadRequestException(
        'Pagamento indisponível: o gateway Asaas não está configurado para tokenizar cartões.',
      );
    }

    const customerId = await resolveConnectAsaasCustomerId(this.asaas, this.config, member, holderName, {
      holderCpf: input.holderCpf,
      holderEmail: input.holderEmail,
      holderPhone: input.holderPhone,
      platformUserId,
    });
    let asaasToken: string;
    try {
      const tokenized = await this.asaas.tokenizeCreditCard({
        customerId,
        creditCard: parsed.creditCard,
        creditCardHolderInfo: this.buildHolderInfo(member, holderName, input),
        remoteIp,
      });
      asaasToken = tokenized.creditCardToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao tokenizar cartão.';
      throw new BadRequestException(`Não foi possível salvar o cartão no gateway: ${message}`);
    }

    if (useForSubscription) {
      if (!member?.active || !member.asaasSubscriptionId) {
        throw new BadRequestException(
          'Para cobrança recorrente, ative um plano Movly antes de cadastrar o cartão.',
        );
      }
      await this.updateAsaasSubscriptionCard(member, holderName, input, {
        remoteIp,
        asaasToken,
        parsed,
      });
    }

    return upsertConnectSavedPaymentMethod({
      holderName,
      brand: parsed.brand,
      lastFour: parsed.lastFour,
      holderNameOnCard: parsed.holderName,
      expiryMonth: parsed.expiryMonth,
      expiryYear: parsed.expiryYear,
      makeDefault: useForSubscription || !member?.savedPaymentMethods?.length,
      billingCardLastFour: useForSubscription ? parsed.lastFour : undefined,
      usedForSubscription: useForSubscription,
      asaasToken,
      addedByUserId: platformUserId,
    });
  }

  async setDefaultPaymentMethod(input: SetDefaultConnectPaymentMethodInput): Promise<ConnectMemberProfile> {
    const holderName = input.holderName.trim();
    if (!holderName) {
      throw new BadRequestException('Informe o nome do titular.');
    }
    const member = this.resolveMember(holderName, input.platformUserId);
    if (!member) {
      throw new BadRequestException('Assinante não encontrado.');
    }

    const methods = member.savedPaymentMethods ?? [];
    const target = findConnectSavedPaymentMethod(methods, input.paymentMethodId);
    if (!target) {
      throw new BadRequestException('Cartão não encontrado.');
    }

    const isBillingCard =
      member.cardLastFour && target.lastFour === member.cardLastFour.trim();
    const applyToSubscription = input.applyToSubscription === true;
    const remoteIp = resolveAsaasRemoteIp(this.config, input.remoteIp);

    if (applyToSubscription && member.active && member.asaasSubscriptionId && !isBillingCard) {
      const storedToken = target.asaasToken?.trim();
      if (storedToken) {
        await this.updateAsaasSubscriptionCard(member, holderName, input, {
          remoteIp,
          asaasToken: storedToken,
        });
        return setConnectSavedPaymentMethodDefault(
          holderName,
          input.paymentMethodId,
          target.lastFour,
          true,
          storedToken,
        );
      }

      if (!input.card) {
        throw new BadRequestException(
          'Este cartão ainda não está tokenizado no gateway. Cadastre-o de novo ou confirme número e CVV uma vez.',
        );
      }
      const parsed = parseConnectCardInput({
        holderName: input.card.holderName || target.holderName,
        number: input.card.number,
        expiryMonth: input.card.expiryMonth || target.expiryMonth,
        expiryYear: input.card.expiryYear || target.expiryYear,
        cvv: input.card.cvv,
        brandHint: input.card.brand || target.brand,
      });
      if (parsed.lastFour !== target.lastFour) {
        throw new BadRequestException('Os dados do cartão não conferem com o cartão selecionado.');
      }
      let asaasToken = storedToken;
      if (this.asaas.isConfigured()) {
        const customerId = await resolveConnectAsaasCustomerId(this.asaas, this.config, member, holderName, {
          holderCpf: input.holderCpf,
          holderEmail: input.holderEmail,
          holderPhone: input.holderPhone,
          platformUserId: input.platformUserId,
        });
        try {
          const tokenized = await this.asaas.tokenizeCreditCard({
            customerId,
            creditCard: parsed.creditCard,
            creditCardHolderInfo: this.buildHolderInfo(member, holderName, input),
            remoteIp,
          });
          asaasToken = tokenized.creditCardToken;
        } catch {
          asaasToken = undefined;
        }
      }
      await this.updateAsaasSubscriptionCard(member, holderName, input, {
        remoteIp,
        asaasToken,
        parsed,
      });
      return setConnectSavedPaymentMethodDefault(
        holderName,
        input.paymentMethodId,
        parsed.lastFour,
        true,
        asaasToken,
      );
    }

    if (applyToSubscription && isBillingCard) {
      return setConnectSavedPaymentMethodDefault(holderName, input.paymentMethodId, undefined, true);
    }

    return setConnectSavedPaymentMethodDefault(holderName, input.paymentMethodId);
  }

  removePaymentMethod(holderName: string, paymentMethodId: string, platformUserId?: string): ConnectMemberProfile {
    const trimmed = holderName.trim();
    if (!trimmed) {
      throw new BadRequestException('Informe o nome do titular.');
    }
    this.resolveMember(trimmed, platformUserId);
    try {
      return removeConnectSavedPaymentMethod(trimmed, paymentMethodId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao remover cartão.';
      throw new BadRequestException(message);
    }
  }

  private async resolveMemberForPayment(holderName: string, platformUserId: string) {
    const user = await this.usersService.findById(platformUserId);
    if (!user?.active) {
      throw new BadRequestException('Sessão inválida. Faça login novamente.');
    }
    const record = ensureConnectMemberForPlatformUser({
      userId: user.id,
      name: user.name.trim() || holderName,
      email: user.email,
      cpf: user.cpf,
    });
    const store = loadStore();
    return findConnectMemberByUserId(store, platformUserId) ?? findConnectMember(store, record.holderName) ?? record;
  }

  private resolveMember(holderName: string, platformUserId?: string) {
    const store = loadStore();
    if (platformUserId?.trim()) {
      const byUser = findConnectMemberByUserId(store, platformUserId);
      if (byUser) return byUser;
    }
    return findConnectMember(store, holderName) ?? null;
  }

  private buildHolderInfo(
    member: NonNullable<ReturnType<typeof findConnectMember>>,
    holderName: string,
    input: Pick<AddConnectPaymentMethodInput, 'holderCpf' | 'holderEmail' | 'holderPhone'>,
  ) {
    const cpfCnpj = resolveConnectCheckoutCpf(input.holderCpf ?? member.holderCpf, this.config);
    const email = input.holderEmail?.trim() || member.holderEmail?.trim() || connectFallbackMemberEmail(holderName);
    const phone = resolveHolderPhone(input.holderPhone ?? member.holderPhone, this.config);
    return buildCreditCardHolderInfo({
      holderName,
      email,
      cpfCnpj,
      phone,
      config: this.config,
    });
  }

  private async updateAsaasSubscriptionCard(
    member: NonNullable<ReturnType<typeof findConnectMember>>,
    holderName: string,
    input: AddConnectPaymentMethodInput | SetDefaultConnectPaymentMethodInput,
    options: {
      remoteIp: string;
      asaasToken?: string;
      parsed?: ReturnType<typeof parseConnectCardInput>;
    },
  ): Promise<void> {
    if (!this.asaas.isConfigured()) {
      throw new BadRequestException(
        'Pagamento indisponível no momento. O gateway Asaas não está configurado.',
      );
    }
    const subscriptionId = member.asaasSubscriptionId?.trim();
    if (!subscriptionId) {
      throw new BadRequestException('Assinatura ativa não encontrada no gateway.');
    }

    const token = options.asaasToken?.trim();
    const parsed = options.parsed;
    try {
      if (token) {
        await this.asaas.updateCreditCardSubscription(subscriptionId, {
          remoteIp: options.remoteIp,
          creditCardToken: token,
        });
        return;
      }

      if (!parsed) {
        throw new BadRequestException('Dados do cartão são obrigatórios para atualizar a mensalidade.');
      }

      const creditCardHolderInfo = this.buildHolderInfo(member, holderName, input);
      await this.asaas.updateCreditCardSubscription(subscriptionId, {
        remoteIp: options.remoteIp,
        creditCard: parsed.creditCard,
        creditCardHolderInfo,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Falha ao atualizar cartão da mensalidade.';
      throw new BadRequestException(message);
    }
  }

  getPaymentMethodsForHolder(holderName: string): ConnectMemberProfile | null {
    return getConnectMemberProfile(holderName);
  }
}