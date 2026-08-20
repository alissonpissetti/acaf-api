import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NextcloudService } from '../storage/nextcloud.service';
import { AccountPayable, type PayableAttachment, type PayableAttachmentKind } from './account-payable.entity';
import { AccountPlan, type AccountPlanKind } from './account-plan.entity';
import { DEFAULT_ACCOUNT_PLANS } from './account-plan.defaults';
import { AccountReceivable } from './account-receivable.entity';
import {
  buildPayerKey,
  payerKindLabel,
  type ReceivableAttachment,
  type ReceivableAttachmentKind,
  type ReceivablePayerKind,
} from './receivable-counterparty.types';
import {
  CashEntryStatus,
  effectiveCashEntryStatus,
} from './cash-entry.types';
import { CostCenter } from './cost-center.entity';
import { Company } from '../corporate/company.entity';
import { AdminService } from '../partner/admin.service';
import { User, UserRole, userHasRole } from '../users/user.entity';
import { formatCpf, formatCnpj } from '../users/person.utils';
import {
  formatPixKey,
  formatSupplierDocument,
  normalizeSupplierDocument,
  PIX_KEY_TYPE_LABELS,
  type PixKeyInput,
  validatePixKeysInput,
} from './pix.utils';
import { SupplierPixKey } from './supplier-pix-key.entity';
import { Supplier } from './supplier.entity';

function parseAmount(value: string | number): string {
  const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) {
    throw new BadRequestException('Informe um valor válido maior que zero.');
  }
  return num.toFixed(2);
}

function addMonthsToDateString(dateStr: string, months: number): string {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setMonth(date.getMonth() + months);
  return date.toISOString().slice(0, 10);
}

const MAX_PAYABLE_RECURRENCE_MONTHS = 60;
const MAX_RECEIVABLE_RECURRENCE_MONTHS = 60;

function mapAccountPlanRef(plan: AccountPlan | null | undefined) {
  if (!plan) return null;
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    kind: plan.kind,
  };
}

function mapPayableRef(row: AccountPayable | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    description: row.description,
    amount: row.amount,
    dueDate: row.dueDate,
    status: effectiveCashEntryStatus(row.status, row.dueDate, row.settledAt),
    counterpartName: row.counterpartName,
  };
}

function mapPayable(row: AccountPayable) {
  return {
    id: row.id,
    type: 'payable' as const,
    direction: 'outflow' as const,
    description: row.description,
    amount: row.amount,
    dueDate: row.dueDate,
    settledAt: row.settledAt,
    expectedSettledAt: row.expectedSettledAt,
    recurrenceGroupId: row.recurrenceGroupId,
    recurrenceIndex: row.recurrenceIndex,
    recurrenceTotal: row.recurrenceTotal,
    status: effectiveCashEntryStatus(row.status, row.dueDate, row.settledAt),
    costCenterId: row.costCenterId,
    costCenter: row.costCenter
      ? { id: row.costCenter.id, code: row.costCenter.code, name: row.costCenter.name }
      : null,
    counterpartName: row.counterpartName,
    supplierId: row.supplierId,
    supplier: row.supplier
      ? {
          id: row.supplier.id,
          name: row.supplier.name,
          document: formatSupplierDocument(row.supplier.document),
        }
      : null,
    category: row.category,
    accountPlanId: row.accountPlanId,
    accountPlan: mapAccountPlanRef(row.accountPlan),
    notes: row.notes,
    attachments: row.attachments ?? [],
    reimbursementSourcePayableId: row.reimbursementSourcePayableId,
    reimbursementPayableId: row.reimbursementPayableId,
    reimbursementSourcePayable: mapPayableRef(row.reimbursementSourcePayable),
    reimbursementPayable: mapPayableRef(row.reimbursementPayable),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapReceivable(row: AccountReceivable) {
  return {
    id: row.id,
    type: 'receivable' as const,
    direction: 'inflow' as const,
    description: row.description,
    amount: row.amount,
    dueDate: row.dueDate,
    settledAt: row.settledAt,
    expectedSettledAt: row.expectedSettledAt,
    recurrenceGroupId: row.recurrenceGroupId,
    recurrenceIndex: row.recurrenceIndex,
    recurrenceTotal: row.recurrenceTotal,
    status: effectiveCashEntryStatus(row.status, row.dueDate, row.settledAt),
    costCenterId: row.costCenterId,
    costCenter: row.costCenter
      ? { id: row.costCenter.id, code: row.costCenter.code, name: row.costCenter.name }
      : null,
    counterpartName: row.counterpartName,
    payerKind: row.payerKind,
    payerRefId: row.payerRefId,
    payerKey: row.payerKind && row.payerRefId ? buildPayerKey(row.payerKind, row.payerRefId) : null,
    payerKindLabel: payerKindLabel(row.payerKind),
    payer: row.payerKind && row.payerRefId
      ? {
          kind: row.payerKind,
          refId: row.payerRefId,
          key: buildPayerKey(row.payerKind, row.payerRefId),
          kindLabel: payerKindLabel(row.payerKind),
          name: row.counterpartName,
        }
      : null,
    category: row.category,
    accountPlanId: row.accountPlanId,
    accountPlan: mapAccountPlanRef(row.accountPlan),
    notes: row.notes,
    attachments: row.attachments ?? [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class FinanceService implements OnModuleInit {
  private readonly logger = new Logger(FinanceService.name);

  constructor(
    @InjectRepository(AccountPayable)
    private readonly payables: Repository<AccountPayable>,
    @InjectRepository(AccountReceivable)
    private readonly receivables: Repository<AccountReceivable>,
    @InjectRepository(AccountPlan)
    private readonly accountPlans: Repository<AccountPlan>,
    @InjectRepository(CostCenter)
    private readonly costCenters: Repository<CostCenter>,
    @InjectRepository(Supplier)
    private readonly suppliers: Repository<Supplier>,
    @InjectRepository(SupplierPixKey)
    private readonly supplierPixKeys: Repository<SupplierPixKey>,
    @InjectRepository(User)
    private readonly platformUsers: Repository<User>,
    @InjectRepository(Company)
    private readonly companies: Repository<Company>,
    private readonly admin: AdminService,
    private readonly storage: NextcloudService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultAccountPlans();
  }

  private mapAccountPlan(row: AccountPlan) {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      kind: row.kind,
      parentId: row.parentId,
      parentName: row.parent?.name ?? null,
      active: row.active,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async ensureDefaultAccountPlans() {
    for (const seed of DEFAULT_ACCOUNT_PLANS) {
      const existing = await this.accountPlans.findOne({ where: { code: seed.code } });
      if (existing) continue;
      await this.accountPlans.save(
        this.accountPlans.create({
          code: seed.code,
          name: seed.name,
          description: seed.description,
          kind: seed.kind,
          active: true,
        }),
      );
    }
    this.logger.log('Planos de conta padrão verificados.');
  }

  private async resolveAccountPlanReference(
    accountPlanId: string | null | undefined,
    expectedKind: AccountPlanKind,
  ) {
    if (!accountPlanId) {
      throw new BadRequestException('Selecione um plano de conta.');
    }
    const plan = await this.accountPlans.findOne({
      where: { id: accountPlanId, active: true },
    });
    if (!plan) throw new BadRequestException('Plano de conta inválido.');
    if (plan.kind !== expectedKind) {
      throw new BadRequestException('Plano de conta incompatível com o tipo de lançamento.');
    }
    return plan;
  }

  private async createReimbursementPayable(
    userId: string,
    source: AccountPayable,
    body: {
      supplierId?: string | null;
      counterpartName?: string;
      dueDate?: string;
    },
  ) {
    const supplier = await this.resolveSupplierReference(body.supplierId);
    const counterpartName = supplier?.name ?? body.counterpartName?.trim();
    if (!counterpartName) {
      throw new BadRequestException('Informe quem deve receber o reembolso.');
    }

    return this.payables.save(
      this.payables.create({
        description: `Reembolso: ${source.description}`,
        amount: source.amount,
        dueDate: body.dueDate ?? source.dueDate,
        settledAt: null,
        status: CashEntryStatus.PENDING,
        costCenterId: source.costCenterId,
        counterpartName,
        supplierId: supplier?.id ?? null,
        accountPlanId: source.accountPlanId,
        category: source.category,
        notes: `Reembolso gerado automaticamente a partir do lançamento "${source.description}".`,
        attachments: [],
        reimbursementSourcePayableId: source.id,
        createdByUserId: userId,
      }),
    );
  }

  async listAccountPlans(filters?: { kind?: AccountPlanKind; active?: boolean }) {
    const rows = await this.accountPlans.find({
      where: {
        ...(filters?.kind ? { kind: filters.kind } : {}),
        ...(filters?.active !== undefined ? { active: filters.active } : {}),
      },
      relations: ['parent'],
      order: { code: 'ASC' },
    });
    return rows.map((row) => this.mapAccountPlan(row));
  }

  async listAccountPlanOptions(kind?: AccountPlanKind) {
    const rows = await this.accountPlans.find({
      where: {
        active: true,
        ...(kind ? { kind } : {}),
      },
      order: { code: 'ASC' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      kind: row.kind,
    }));
  }

  async getAccountPlan(id: string) {
    const row = await this.accountPlans.findOne({ where: { id }, relations: ['parent'] });
    if (!row) throw new NotFoundException('Plano de conta não encontrado.');
    return this.mapAccountPlan(row);
  }

  async createAccountPlan(body: {
    code: string;
    name: string;
    description?: string;
    kind: AccountPlanKind;
    parentId?: string | null;
    active?: boolean;
  }) {
    const code = body.code?.trim();
    const name = body.name?.trim();
    if (!code) throw new BadRequestException('Informe o código do plano de conta.');
    if (!name) throw new BadRequestException('Informe o nome do plano de conta.');
    if (body.kind !== 'expense' && body.kind !== 'revenue') {
      throw new BadRequestException('Tipo de plano inválido.');
    }

    let parentId: string | null = null;
    if (body.parentId) {
      const parent = await this.accountPlans.findOne({ where: { id: body.parentId } });
      if (!parent) throw new BadRequestException('Plano pai inválido.');
      if (parent.kind !== body.kind) {
        throw new BadRequestException('O plano pai deve ser do mesmo tipo.');
      }
      parentId = parent.id;
    }

    const saved = await this.accountPlans.save(
      this.accountPlans.create({
        code,
        name,
        description: body.description?.trim() || null,
        kind: body.kind,
        parentId,
        active: body.active ?? true,
      }),
    );
    return this.getAccountPlan(saved.id);
  }

  async updateAccountPlan(
    id: string,
    body: Partial<{
      code: string;
      name: string;
      description: string | null;
      kind: AccountPlanKind;
      parentId: string | null;
      active: boolean;
    }>,
  ) {
    const row = await this.accountPlans.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Plano de conta não encontrado.');

    if (body.code !== undefined) {
      const code = body.code.trim();
      if (!code) throw new BadRequestException('Informe o código do plano de conta.');
      row.code = code;
    }
    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('Informe o nome do plano de conta.');
      row.name = name;
    }
    if (body.description !== undefined) row.description = body.description?.trim() || null;
    if (body.kind !== undefined) {
      if (body.kind !== 'expense' && body.kind !== 'revenue') {
        throw new BadRequestException('Tipo de plano inválido.');
      }
      row.kind = body.kind;
    }
    if (body.parentId !== undefined) {
      if (body.parentId) {
        if (body.parentId === row.id) {
          throw new BadRequestException('O plano não pode ser pai de si mesmo.');
        }
        const parent = await this.accountPlans.findOne({ where: { id: body.parentId } });
        if (!parent) throw new BadRequestException('Plano pai inválido.');
        if (parent.kind !== row.kind) {
          throw new BadRequestException('O plano pai deve ser do mesmo tipo.');
        }
        row.parentId = parent.id;
      } else {
        row.parentId = null;
      }
    }
    if (body.active !== undefined) row.active = body.active;

    await this.accountPlans.save(row);
    return this.getAccountPlan(row.id);
  }

  private mapPixKey(row: SupplierPixKey) {
    return {
      id: row.id,
      type: row.type,
      typeLabel: PIX_KEY_TYPE_LABELS[row.type],
      keyValue: row.keyValue,
      keyDisplay: formatPixKey(row.type, row.keyValue),
      label: row.label,
      isPrimary: row.isPrimary,
      active: row.active,
    };
  }

  private mapSupplier(row: Supplier) {
    const pixKeys = (row.pixKeys ?? []).map((item) => this.mapPixKey(item));
    return {
      id: row.id,
      name: row.name,
      legalName: row.legalName,
      document: row.document,
      documentFormatted: formatSupplierDocument(row.document),
      email: row.email,
      phone: row.phone,
      notes: row.notes,
      active: row.active,
      pixKeys,
      primaryPixKey: pixKeys.find((item) => item.isPrimary && item.active) ?? pixKeys[0] ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async resolveSupplierReference(supplierId?: string | null) {
    if (!supplierId) return null;
    const supplier = await this.suppliers.findOne({ where: { id: supplierId, active: true } });
    if (!supplier) throw new BadRequestException('Fornecedor inválido.');
    return supplier;
  }

  private async syncSupplierPixKeys(supplierId: string, keys: PixKeyInput[]) {
    let normalized: PixKeyInput[];
    try {
      normalized = validatePixKeysInput(keys);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Chave PIX inválida.');
    }

    const existing = await this.supplierPixKeys.find({ where: { supplierId } });
    const keepIds = new Set(normalized.map((key) => key.id).filter(Boolean));

    for (const row of existing) {
      if (!keepIds.has(row.id)) {
        await this.supplierPixKeys.remove(row);
      }
    }

    for (const key of normalized) {
      if (key.id) {
        const row = existing.find((item) => item.id === key.id);
        if (!row) continue;
        row.type = key.type;
        row.keyValue = key.keyValue;
        row.label = key.label ?? null;
        row.isPrimary = Boolean(key.isPrimary);
        row.active = key.active ?? true;
        await this.supplierPixKeys.save(row);
        continue;
      }

      await this.supplierPixKeys.save(
        this.supplierPixKeys.create({
          supplierId,
          type: key.type,
          keyValue: key.keyValue,
          label: key.label ?? null,
          isPrimary: Boolean(key.isPrimary),
          active: key.active ?? true,
        }),
      );
    }
  }

  async listSuppliers() {
    const rows = await this.suppliers.find({
      relations: ['pixKeys'],
      order: { name: 'ASC' },
    });
    return rows.map((row) => this.mapSupplier(row));
  }

  async listSupplierOptions() {
    const rows = await this.suppliers.find({
      where: { active: true },
      relations: ['pixKeys'],
      order: { name: 'ASC' },
    });
    return rows.map((row) => {
      const mapped = this.mapSupplier(row);
      return {
        id: mapped.id,
        name: mapped.name,
        documentFormatted: mapped.documentFormatted,
        primaryPixKey: mapped.primaryPixKey,
      };
    });
  }

  async getSupplier(id: string) {
    const row = await this.suppliers.findOne({ where: { id }, relations: ['pixKeys'] });
    if (!row) throw new NotFoundException('Fornecedor não encontrado.');
    return this.mapSupplier(row);
  }

  async createSupplier(body: {
    name: string;
    legalName?: string;
    document?: string;
    email?: string;
    phone?: string;
    notes?: string;
    active?: boolean;
    pixKeys?: PixKeyInput[];
  }) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('Informe o nome do fornecedor.');

    let document: string | null = null;
    try {
      document = normalizeSupplierDocument(body.document);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Documento inválido.');
    }

    const saved = await this.suppliers.save(
      this.suppliers.create({
        name,
        legalName: body.legalName?.trim() || null,
        document,
        email: body.email?.trim().toLowerCase() || null,
        phone: body.phone?.trim() || null,
        notes: body.notes?.trim() || null,
        active: body.active ?? true,
      }),
    );

    if (body.pixKeys?.length) {
      await this.syncSupplierPixKeys(saved.id, body.pixKeys);
    }

    return this.getSupplier(saved.id);
  }

  async updateSupplier(
    id: string,
    body: Partial<{
      name: string;
      legalName: string | null;
      document: string | null;
      email: string | null;
      phone: string | null;
      notes: string | null;
      active: boolean;
      pixKeys: PixKeyInput[];
    }>,
  ) {
    const row = await this.suppliers.findOne({ where: { id }, relations: ['pixKeys'] });
    if (!row) throw new NotFoundException('Fornecedor não encontrado.');

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('Informe o nome do fornecedor.');
      row.name = name;
    }
    if (body.legalName !== undefined) row.legalName = body.legalName?.trim() || null;
    if (body.document !== undefined) {
      try {
        row.document = normalizeSupplierDocument(body.document);
      } catch (err) {
        throw new BadRequestException(err instanceof Error ? err.message : 'Documento inválido.');
      }
    }
    if (body.email !== undefined) row.email = body.email?.trim().toLowerCase() || null;
    if (body.phone !== undefined) row.phone = body.phone?.trim() || null;
    if (body.notes !== undefined) row.notes = body.notes?.trim() || null;
    if (body.active !== undefined) row.active = body.active;

    await this.suppliers.save(row);

    if (body.pixKeys !== undefined) {
      await this.syncSupplierPixKeys(row.id, body.pixKeys);
    }

    return this.getSupplier(row.id);
  }

  async listCostCenters() {
    const rows = await this.costCenters.find({
      relations: ['department'],
      order: { name: 'ASC' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      active: row.active,
    }));
  }

  async createCostCenter(body: {
    code: string;
    name: string;
    departmentId?: string | null;
    active?: boolean;
  }) {
    return this.costCenters.save(
      this.costCenters.create({
        code: body.code.trim().toUpperCase(),
        name: body.name.trim(),
        departmentId: body.departmentId ?? null,
        active: body.active ?? true,
      }),
    );
  }

  async updateCostCenter(
    id: string,
    body: Partial<{ code: string; name: string; departmentId: string | null; active: boolean }>,
  ) {
    const row = await this.costCenters.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Centro de custo não encontrado.');
    if (body.code !== undefined) row.code = body.code.trim().toUpperCase();
    if (body.name !== undefined) row.name = body.name.trim();
    if (body.departmentId !== undefined) row.departmentId = body.departmentId;
    if (body.active !== undefined) row.active = body.active;
    return this.costCenters.save(row);
  }

  async listPayables(filters?: { status?: CashEntryStatus; costCenterId?: string }) {
    const rows = await this.payables.find({
      where: {
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.costCenterId ? { costCenterId: filters.costCenterId } : {}),
      },
      relations: [
        'costCenter',
        'supplier',
        'accountPlan',
        'reimbursementPayable',
        'reimbursementSourcePayable',
      ],
      order: { dueDate: 'DESC', createdAt: 'DESC' },
    });
    return rows.map(mapPayable);
  }

  private async loadPayable(id: string) {
    const row = await this.payables.findOne({
      where: { id },
      relations: [
        'costCenter',
        'supplier',
        'accountPlan',
        'reimbursementPayable',
        'reimbursementSourcePayable',
      ],
    });
    if (!row) throw new NotFoundException('Conta a pagar não encontrada.');
    return row;
  }

  async createPayable(
    userId: string,
    body: {
      description: string;
      amount: string | number;
      dueDate: string;
      costCenterId: string;
      counterpartName: string;
      supplierId?: string | null;
      accountPlanId: string;
      category?: string;
      notes?: string;
      expectedSettledAt?: string | null;
      generateReimbursement?: boolean;
      reimbursementSupplierId?: string | null;
      reimbursementCounterpartName?: string;
      reimbursementDueDate?: string;
      recurrenceMonths?: number;
    },
  ) {
    const costCenter = await this.costCenters.findOne({ where: { id: body.costCenterId } });
    if (!costCenter) throw new BadRequestException('Centro de custo inválido.');

    const supplier = await this.resolveSupplierReference(body.supplierId);
    const counterpartName = supplier?.name ?? body.counterpartName?.trim();
    if (!counterpartName) throw new BadRequestException('Informe o fornecedor.');

    const accountPlan = await this.resolveAccountPlanReference(body.accountPlanId, 'expense');

    const recurrenceMonths = body.recurrenceMonths ?? 1;
    if (!Number.isInteger(recurrenceMonths) || recurrenceMonths < 1 || recurrenceMonths > MAX_PAYABLE_RECURRENCE_MONTHS) {
      throw new BadRequestException(`Informe entre 1 e ${MAX_PAYABLE_RECURRENCE_MONTHS} meses na série.`);
    }
    if (recurrenceMonths > 1 && body.generateReimbursement) {
      throw new BadRequestException('Reembolso não está disponível em lançamentos recorrentes.');
    }

    const recurrenceGroupId = recurrenceMonths > 1 ? randomUUID() : null;
    const baseDescription = body.description.trim();
    const amount = parseAmount(body.amount);
    let firstSaved: AccountPayable | null = null;

    for (let index = 0; index < recurrenceMonths; index += 1) {
      const dueDate = addMonthsToDateString(body.dueDate, index);
      const expectedSettledAt = body.expectedSettledAt
        ? addMonthsToDateString(body.expectedSettledAt, index)
        : null;
      const description =
        recurrenceMonths > 1 ? `${baseDescription} (${index + 1}/${recurrenceMonths})` : baseDescription;

      const saved = await this.payables.save(
        this.payables.create({
          description,
          amount,
          dueDate,
          settledAt: null,
          expectedSettledAt,
          recurrenceGroupId,
          recurrenceIndex: recurrenceMonths > 1 ? index + 1 : null,
          recurrenceTotal: recurrenceMonths > 1 ? recurrenceMonths : null,
          status: CashEntryStatus.PENDING,
          costCenterId: body.costCenterId,
          counterpartName,
          supplierId: supplier?.id ?? null,
          accountPlanId: accountPlan.id,
          category: body.category?.trim() || accountPlan.name,
          notes: body.notes?.trim() || null,
          attachments: [],
          createdByUserId: userId,
        }),
      );

      if (index === 0) {
        firstSaved = saved;
      }
    }

    if (!firstSaved) {
      throw new BadRequestException('Não foi possível criar a série de lançamentos.');
    }

    if (body.generateReimbursement) {
      const reimbursement = await this.createReimbursementPayable(userId, firstSaved, {
        supplierId: body.reimbursementSupplierId,
        counterpartName: body.reimbursementCounterpartName,
        dueDate: body.reimbursementDueDate,
      });
      firstSaved.reimbursementPayableId = reimbursement.id;
      await this.payables.save(firstSaved);
    }

    const mapped = mapPayable(await this.loadPayable(firstSaved.id));
    if (recurrenceMonths > 1) {
      return {
        ...mapped,
        seriesCount: recurrenceMonths,
        recurrenceGroupId,
      };
    }
    return mapped;
  }

  async updatePayable(
    id: string,
    body: Partial<{
      description: string;
      amount: string | number;
      dueDate: string;
      costCenterId: string;
      counterpartName: string;
      supplierId: string | null;
      accountPlanId: string;
      category: string;
      notes: string;
      status: CashEntryStatus;
      settledAt?: string | null;
      expectedSettledAt?: string | null;
      generateReimbursement?: boolean;
      reimbursementSupplierId?: string | null;
      reimbursementCounterpartName?: string;
      reimbursementDueDate?: string;
    }>,
  ) {
    const row = await this.loadPayable(id);
    if (body.description !== undefined) row.description = body.description.trim();
    if (body.amount !== undefined) row.amount = parseAmount(body.amount);
    if (body.dueDate !== undefined) row.dueDate = body.dueDate;
    if (body.costCenterId !== undefined) row.costCenterId = body.costCenterId;
    if (body.supplierId !== undefined) {
      const supplier = await this.resolveSupplierReference(body.supplierId);
      row.supplierId = supplier?.id ?? null;
      if (supplier) row.counterpartName = supplier.name;
    }
    if (body.counterpartName !== undefined && body.supplierId === undefined && !row.supplierId) {
      row.counterpartName = body.counterpartName.trim();
    }
    if (body.accountPlanId !== undefined) {
      const accountPlan = await this.resolveAccountPlanReference(body.accountPlanId, 'expense');
      row.accountPlanId = accountPlan.id;
      row.category = body.category?.trim() || accountPlan.name;
    } else if (body.category !== undefined) {
      row.category = body.category?.trim() || null;
    }
    if (body.notes !== undefined) row.notes = body.notes?.trim() || null;
    if (body.status !== undefined) row.status = body.status;
    if (body.settledAt !== undefined) {
      row.settledAt = body.settledAt ? new Date(body.settledAt) : null;
      if (body.status === undefined) {
        row.status = body.settledAt ? CashEntryStatus.SETTLED : CashEntryStatus.PENDING;
      }
      if (body.settledAt) {
        row.expectedSettledAt = null;
      }
    }
    if (body.expectedSettledAt !== undefined) {
      row.expectedSettledAt = body.expectedSettledAt || null;
    }
    await this.payables.save(row);

    if (body.generateReimbursement && !row.reimbursementPayableId) {
      const reimbursement = await this.createReimbursementPayable(row.createdByUserId, row, {
        supplierId: body.reimbursementSupplierId,
        counterpartName: body.reimbursementCounterpartName,
        dueDate: body.reimbursementDueDate,
      });
      row.reimbursementPayableId = reimbursement.id;
      await this.payables.save(row);
    }

    return mapPayable(await this.loadPayable(row.id));
  }

  async settlePayable(id: string, settledAt?: string) {
    const row = await this.loadPayable(id);
    row.settledAt = settledAt ? new Date(settledAt) : new Date();
    row.expectedSettledAt = null;
    row.status = CashEntryStatus.SETTLED;
    await this.payables.save(row);
    return mapPayable(row);
  }

  async uploadPayableAttachments(
    id: string,
    files: Express.Multer.File[],
    options?: { kind?: PayableAttachmentKind; settledAt?: string },
  ) {
    const row = await this.loadPayable(id);
    const kind = options?.kind === 'payment_receipt' ? 'payment_receipt' : 'general';

    const current = row.attachments ?? [];
    if (current.length + files.length > 20) {
      throw new BadRequestException('Limite de 20 anexos por lançamento.');
    }

    let settlementMoment: Date | null = null;
    if (kind === 'payment_receipt') {
      settlementMoment = options?.settledAt ? new Date(options.settledAt) : new Date();
      if (Number.isNaN(settlementMoment.getTime())) {
        throw new BadRequestException('Data/hora de pagamento inválida.');
      }
    }

    const uploaded: PayableAttachment[] = [];
    for (const file of files) {
      const stored = await this.storage.uploadPayableAttachment(id, file);
      uploaded.push({
        id: randomUUID(),
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: stored.path,
        publicUrl: stored.publicUrl,
        uploadedAt: new Date().toISOString(),
        kind,
        recordedSettledAt:
          kind === 'payment_receipt' && settlementMoment
            ? settlementMoment.toISOString()
            : null,
      });
    }

    row.attachments = [...current, ...uploaded];
    if (kind === 'payment_receipt' && settlementMoment) {
      row.settledAt = settlementMoment;
      row.expectedSettledAt = null;
      row.status = CashEntryStatus.SETTLED;
    }
    await this.payables.save(row);
    return mapPayable(row);
  }

  async deletePayableAttachment(id: string, attachmentId: string) {
    const row = await this.loadPayable(id);

    const current = row.attachments ?? [];
    const target = current.find((item) => item.id === attachmentId);
    if (!target) throw new NotFoundException('Anexo não encontrado.');

    await this.storage.deleteFile(target.path);
    row.attachments = current.filter((item) => item.id !== attachmentId);
    await this.payables.save(row);
    return mapPayable(row);
  }

  async deletePayable(id: string) {
    const row = await this.loadPayable(id);
    if (row.status !== CashEntryStatus.CANCELLED) {
      throw new BadRequestException('Somente lançamentos cancelados podem ser excluídos.');
    }

    if (row.reimbursementPayableId) {
      const reimbursement = await this.payables.findOne({ where: { id: row.reimbursementPayableId } });
      if (reimbursement) {
        throw new BadRequestException('Exclua o reembolso vinculado antes de remover este lançamento.');
      }
      row.reimbursementPayableId = null;
      await this.payables.save(row);
    }

    if (row.reimbursementSourcePayableId) {
      const source = await this.payables.findOne({ where: { id: row.reimbursementSourcePayableId } });
      if (source) {
        source.reimbursementPayableId = null;
        await this.payables.save(source);
      }
    }

    for (const attachment of row.attachments ?? []) {
      try {
        await this.storage.deleteFile(attachment.path);
      } catch {
        // Ignora falha ao remover arquivo externo; o registro ainda será excluído.
      }
    }

    await this.payables.remove(row);
    return { ok: true };
  }

  async listPayerOptions() {
    const [users, companies, networks] = await Promise.all([
      this.platformUsers.find({ where: { active: true }, order: { name: 'ASC' } }),
      this.companies.find({ order: { tradeName: 'ASC' } }),
      this.admin.listNetworks(),
    ]);

    const clients = users
      .filter((user) => userHasRole(user, UserRole.MEMBER))
      .map((user) => ({
        kind: 'client' as const,
        refId: user.id,
        key: buildPayerKey('client', user.id),
        name: user.name,
        kindLabel: payerKindLabel('client'),
        subtitle: user.email,
        document: user.cpf ? formatCpf(user.cpf) : null,
      }));

    const companyRows = companies.map((company) => ({
      kind: 'company' as const,
      refId: company.id,
      key: buildPayerKey('company', company.id),
      name: company.tradeName || company.legalName,
      kindLabel: payerKindLabel('company'),
      subtitle: company.legalName,
      document: company.cnpj ? formatCnpj(company.cnpj) : null,
    }));

    const partnerRows = networks.map((network) => ({
      kind: 'partner' as const,
      refId: network.id,
      key: buildPayerKey('partner', network.id),
      name: network.name,
      kindLabel: payerKindLabel('partner'),
      subtitle: 'Rede parceira',
      document: null,
    }));

    return [...clients, ...companyRows, ...partnerRows].sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
    );
  }

  private parsePayerKind(value?: string | null): ReceivablePayerKind | null {
    if (value === 'client' || value === 'company' || value === 'partner') return value;
    return null;
  }

  private async resolvePayerReference(
    payerKind?: string | null,
    payerRefId?: string | null,
  ): Promise<{ kind: ReceivablePayerKind; refId: string; name: string } | null> {
    const kind = this.parsePayerKind(payerKind);
    const refId = payerRefId?.trim();
    if (!kind || !refId) return null;

    if (kind === 'client') {
      const user = await this.platformUsers.findOne({ where: { id: refId, active: true } });
      if (!user || !userHasRole(user, UserRole.MEMBER)) {
        throw new BadRequestException('Cliente pagador inválido.');
      }
      return { kind, refId, name: user.name };
    }

    if (kind === 'company') {
      const company = await this.companies.findOne({ where: { id: refId } });
      if (!company) throw new BadRequestException('Empresa pagadora inválida.');
      return { kind, refId, name: company.tradeName || company.legalName };
    }

    const networks = await this.admin.listNetworks();
    const network = networks.find((row) => row.id === refId);
    if (!network) throw new BadRequestException('Parceiro pagador inválido.');
    return { kind, refId, name: network.name };
  }

  private async loadReceivable(id: string) {
    const row = await this.receivables.findOne({
      where: { id },
      relations: ['costCenter', 'accountPlan'],
    });
    if (!row) throw new NotFoundException('Conta a receber não encontrada.');
    return row;
  }

  async listReceivables(filters?: { status?: CashEntryStatus; costCenterId?: string }) {
    const rows = await this.receivables.find({
      where: {
        ...(filters?.status ? { status: filters.status } : {}),
        ...(filters?.costCenterId ? { costCenterId: filters.costCenterId } : {}),
      },
      relations: ['costCenter', 'accountPlan'],
      order: { dueDate: 'DESC', createdAt: 'DESC' },
    });
    return rows.map(mapReceivable);
  }

  async createReceivable(
    userId: string,
    body: {
      description: string;
      amount: string | number;
      dueDate: string;
      costCenterId: string;
      counterpartName: string;
      payerKind?: ReceivablePayerKind | null;
      payerRefId?: string | null;
      accountPlanId: string;
      category?: string;
      notes?: string;
      expectedSettledAt?: string | null;
      recurrenceMonths?: number;
    },
  ) {
    const costCenter = await this.costCenters.findOne({ where: { id: body.costCenterId } });
    if (!costCenter) throw new BadRequestException('Centro de custo inválido.');

    const payer = await this.resolvePayerReference(body.payerKind, body.payerRefId);
    const counterpartName = payer?.name ?? body.counterpartName?.trim();
    if (!counterpartName) throw new BadRequestException('Informe o pagador.');

    const accountPlan = await this.resolveAccountPlanReference(body.accountPlanId, 'revenue');

    const recurrenceMonths = body.recurrenceMonths ?? 1;
    if (
      !Number.isInteger(recurrenceMonths) ||
      recurrenceMonths < 1 ||
      recurrenceMonths > MAX_RECEIVABLE_RECURRENCE_MONTHS
    ) {
      throw new BadRequestException(
        `Informe entre 1 e ${MAX_RECEIVABLE_RECURRENCE_MONTHS} meses na série.`,
      );
    }

    const recurrenceGroupId = recurrenceMonths > 1 ? randomUUID() : null;
    const baseDescription = body.description.trim();
    const amount = parseAmount(body.amount);
    let firstSaved: AccountReceivable | null = null;

    for (let index = 0; index < recurrenceMonths; index += 1) {
      const dueDate = addMonthsToDateString(body.dueDate, index);
      const expectedSettledAt = body.expectedSettledAt
        ? addMonthsToDateString(body.expectedSettledAt, index)
        : null;
      const description =
        recurrenceMonths > 1 ? `${baseDescription} (${index + 1}/${recurrenceMonths})` : baseDescription;

      const saved = await this.receivables.save(
        this.receivables.create({
          description,
          amount,
          dueDate,
          settledAt: null,
          expectedSettledAt,
          recurrenceGroupId,
          recurrenceIndex: recurrenceMonths > 1 ? index + 1 : null,
          recurrenceTotal: recurrenceMonths > 1 ? recurrenceMonths : null,
          status: CashEntryStatus.PENDING,
          costCenterId: body.costCenterId,
          counterpartName,
          payerKind: payer?.kind ?? null,
          payerRefId: payer?.refId ?? null,
          accountPlanId: accountPlan.id,
          category: body.category?.trim() || accountPlan.name,
          notes: body.notes?.trim() || null,
          attachments: [],
          createdByUserId: userId,
        }),
      );
      if (!firstSaved) firstSaved = saved;
    }

    const mapped = mapReceivable(await this.loadReceivable(firstSaved!.id));
    if (recurrenceMonths > 1) {
      return {
        ...mapped,
        seriesCount: recurrenceMonths,
        recurrenceGroupId,
      };
    }
    return mapped;
  }

  async updateReceivable(
    id: string,
    body: Partial<{
      description: string;
      amount: string | number;
      dueDate: string;
      costCenterId: string;
      counterpartName: string;
      payerKind: ReceivablePayerKind | null;
      payerRefId: string | null;
      accountPlanId: string;
      category: string;
      notes: string;
      status: CashEntryStatus;
      settledAt?: string | null;
      expectedSettledAt?: string | null;
    }>,
  ) {
    const row = await this.loadReceivable(id);
    if (body.description !== undefined) row.description = body.description.trim();
    if (body.amount !== undefined) row.amount = parseAmount(body.amount);
    if (body.dueDate !== undefined) row.dueDate = body.dueDate;
    if (body.costCenterId !== undefined) row.costCenterId = body.costCenterId;

    if (body.payerKind !== undefined || body.payerRefId !== undefined) {
      const nextKind = body.payerKind === undefined ? row.payerKind : body.payerKind;
      const nextRefId = body.payerRefId === undefined ? row.payerRefId : body.payerRefId;
      if (nextKind && nextRefId) {
        const payer = await this.resolvePayerReference(nextKind, nextRefId);
        row.payerKind = payer!.kind;
        row.payerRefId = payer!.refId;
        row.counterpartName = payer!.name;
      } else {
        row.payerKind = null;
        row.payerRefId = null;
        if (body.counterpartName !== undefined) {
          row.counterpartName = body.counterpartName.trim();
        }
      }
    } else if (body.counterpartName !== undefined && !row.payerKind) {
      row.counterpartName = body.counterpartName.trim();
    }

    if (body.accountPlanId !== undefined) {
      const accountPlan = await this.resolveAccountPlanReference(body.accountPlanId, 'revenue');
      row.accountPlanId = accountPlan.id;
      row.category = body.category?.trim() || accountPlan.name;
    } else if (body.category !== undefined) {
      row.category = body.category?.trim() || null;
    }
    if (body.notes !== undefined) row.notes = body.notes?.trim() || null;
    if (body.status !== undefined) row.status = body.status;
    if (body.settledAt !== undefined) {
      row.settledAt = body.settledAt ? new Date(body.settledAt) : null;
      if (body.status === undefined) {
        row.status = body.settledAt ? CashEntryStatus.SETTLED : CashEntryStatus.PENDING;
      }
      if (body.settledAt) {
        row.expectedSettledAt = null;
      }
    }
    if (body.expectedSettledAt !== undefined) {
      row.expectedSettledAt = body.expectedSettledAt || null;
    }
    await this.receivables.save(row);
    return mapReceivable(await this.loadReceivable(row.id));
  }

  async settleReceivable(id: string, settledAt?: string) {
    const row = await this.loadReceivable(id);
    row.settledAt = settledAt ? new Date(settledAt) : new Date();
    row.expectedSettledAt = null;
    row.status = CashEntryStatus.SETTLED;
    await this.receivables.save(row);
    return mapReceivable(row);
  }

  async uploadReceivableAttachments(
    id: string,
    files: Express.Multer.File[],
    options?: { kind?: ReceivableAttachmentKind; settledAt?: string },
  ) {
    const row = await this.loadReceivable(id);
    const kind = options?.kind === 'payment_receipt' ? 'payment_receipt' : 'general';

    const current = row.attachments ?? [];
    if (current.length + files.length > 20) {
      throw new BadRequestException('Limite de 20 anexos por lançamento.');
    }

    let settlementMoment: Date | null = null;
    if (kind === 'payment_receipt') {
      settlementMoment = options?.settledAt ? new Date(options.settledAt) : new Date();
      if (Number.isNaN(settlementMoment.getTime())) {
        throw new BadRequestException('Data/hora de recebimento inválida.');
      }
    }

    const uploaded: ReceivableAttachment[] = [];
    for (const file of files) {
      const stored = await this.storage.uploadReceivableAttachment(id, file);
      uploaded.push({
        id: randomUUID(),
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        path: stored.path,
        publicUrl: stored.publicUrl,
        uploadedAt: new Date().toISOString(),
        kind,
        recordedSettledAt:
          kind === 'payment_receipt' && settlementMoment
            ? settlementMoment.toISOString()
            : null,
      });
    }

    row.attachments = [...current, ...uploaded];
    if (kind === 'payment_receipt' && settlementMoment) {
      row.settledAt = settlementMoment;
      row.expectedSettledAt = null;
      row.status = CashEntryStatus.SETTLED;
    }
    await this.receivables.save(row);
    return mapReceivable(row);
  }

  async deleteReceivableAttachment(id: string, attachmentId: string) {
    const row = await this.loadReceivable(id);

    const current = row.attachments ?? [];
    const target = current.find((item) => item.id === attachmentId);
    if (!target) throw new NotFoundException('Anexo não encontrado.');

    await this.storage.deleteFile(target.path);
    row.attachments = current.filter((item) => item.id !== attachmentId);
    await this.receivables.save(row);
    return mapReceivable(row);
  }

  async deleteReceivable(id: string) {
    const row = await this.receivables.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Conta a receber não encontrada.');
    if (row.status !== CashEntryStatus.CANCELLED) {
      throw new BadRequestException('Somente lançamentos cancelados podem ser excluídos.');
    }

    for (const attachment of row.attachments ?? []) {
      try {
        await this.storage.deleteFile(attachment.path);
      } catch {
        // Ignora falha ao remover arquivo externo; o registro ainda será excluído.
      }
    }

    await this.receivables.remove(row);
    return { ok: true };
  }

  async getCashFlow(filters?: {
    from?: string;
    to?: string;
    costCenterId?: string;
    status?: CashEntryStatus;
  }) {
    const payables = await this.listPayables({
      costCenterId: filters?.costCenterId,
      status: filters?.status,
    });
    const receivables = await this.listReceivables({
      costCenterId: filters?.costCenterId,
      status: filters?.status,
    });

    let entries = [...payables, ...receivables];

    if (filters?.from || filters?.to) {
      entries = entries.filter((entry) => {
        const due = entry.dueDate;
        if (filters.from && due < filters.from) return false;
        if (filters.to && due > filters.to) return false;
        return true;
      });
    }

    entries.sort((a, b) => {
      if (a.dueDate === b.dueDate) return 0;
      return a.dueDate < b.dueDate ? 1 : -1;
    });

    const activeEntries = entries.filter((row) => row.status !== CashEntryStatus.CANCELLED);

    const settledInflow = activeEntries
      .filter((row) => row.direction === 'inflow' && row.status === CashEntryStatus.SETTLED)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const settledOutflow = activeEntries
      .filter((row) => row.direction === 'outflow' && row.status === CashEntryStatus.SETTLED)
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const pendingInflow = activeEntries
      .filter(
        (row) =>
          row.direction === 'inflow' &&
          row.status !== CashEntryStatus.SETTLED &&
          row.status !== CashEntryStatus.CANCELLED,
      )
      .reduce((sum, row) => sum + Number(row.amount), 0);
    const pendingOutflow = activeEntries
      .filter(
        (row) =>
          row.direction === 'outflow' &&
          row.status !== CashEntryStatus.SETTLED &&
          row.status !== CashEntryStatus.CANCELLED,
      )
      .reduce((sum, row) => sum + Number(row.amount), 0);

    return {
      entries,
      summary: {
        totalInflow: settledInflow.toFixed(2),
        totalOutflow: settledOutflow.toFixed(2),
        balance: (settledInflow - settledOutflow).toFixed(2),
        pendingInflow: pendingInflow.toFixed(2),
        pendingOutflow: pendingOutflow.toFixed(2),
      },
    };
  }
}
