import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommercialLossReason } from './commercial-loss-reason.entity';

const SEED_LABELS = [
  'Preço / orçamento',
  'Sem resposta do lead',
  'Escolheu concorrente',
  'Sem fit com a solução',
  'Timing — sem prioridade agora',
  'Decisão interna / pausa do projeto',
];

export function normalizeLossReasonKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

@Injectable()
export class CommercialLossReasonsService implements OnModuleInit {
  constructor(
    @InjectRepository(CommercialLossReason)
    private readonly reasons: Repository<CommercialLossReason>,
  ) {}

  async onModuleInit() {
    await this.seedDefaultsIfEmpty();
  }

  async listActive() {
    await this.seedDefaultsIfEmpty();
    const rows = await this.reasons.find({
      where: { active: true },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
    return rows.map((row) => this.toDto(row));
  }

  async resolveForLost(input: { lossReasonId?: string; lossReasonCustom?: string }): Promise<string> {
    const reasonId = input.lossReasonId?.trim();
    if (reasonId) {
      const existing = await this.reasons.findOne({ where: { id: reasonId, active: true } });
      if (!existing) {
        throw new BadRequestException('Motivo de perda inválido.');
      }
      return existing.id;
    }

    const custom = input.lossReasonCustom?.trim();
    if (!custom) {
      throw new BadRequestException('Informe o motivo da perda.');
    }
    if (custom.length > 120) {
      throw new BadRequestException('Motivo muito longo (máximo 120 caracteres).');
    }

    return this.ensureLabel(custom);
  }

  async getLabel(reasonId: string): Promise<string> {
    const row = await this.reasons.findOne({ where: { id: reasonId } });
    return row?.label ?? '—';
  }

  async ensureLabel(label: string): Promise<string> {
    const normalized = normalizeLossReasonKey(label);
    if (!normalized) {
      throw new BadRequestException('Motivo inválido.');
    }

    const existing = await this.reasons.findOne({ where: { labelKey: normalized } });
    if (existing) {
      if (!existing.active) {
        existing.active = true;
        await this.reasons.save(existing);
      }
      return existing.id;
    }

    const sortOrder = await this.nextSortOrder();
    const saved = await this.reasons.save(
      this.reasons.create({
        label: label.trim(),
        labelKey: normalized,
        sortOrder,
        active: true,
      }),
    );
    return saved.id;
  }

  private async seedDefaultsIfEmpty() {
    const count = await this.reasons.count();
    if (count > 0) return;

    await this.reasons.save(
      SEED_LABELS.map((label, index) =>
        this.reasons.create({
          label,
          labelKey: normalizeLossReasonKey(label),
          sortOrder: index + 1,
          active: true,
        }),
      ),
    );
  }

  private async nextSortOrder() {
    const row = await this.reasons.findOne({
      where: {},
      order: { sortOrder: 'DESC' },
    });
    return (row?.sortOrder ?? 0) + 1;
  }

  private toDto(row: CommercialLossReason) {
    return {
      id: row.id,
      label: row.label,
      sortOrder: row.sortOrder,
    };
  }
}
