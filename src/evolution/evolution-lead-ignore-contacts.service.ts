import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isValidMobilePhone, normalizeMobilePhone, resolveBrazilMobilePhone } from '../users/person.utils';
import { normalizedBrazilMobileKey } from './evolution-contact.resolver';
import {
  EvolutionLeadIgnoreContact,
  type EvolutionLeadIgnoreMatchKind,
} from './evolution-lead-ignore-contact.entity';
import { EvolutionInstance } from './evolution-instance.entity';

export type EvolutionLeadIgnoreContactDto = {
  id: string;
  instanceId: string;
  matchKind: EvolutionLeadIgnoreMatchKind;
  matchValue: string;
  label: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateEvolutionLeadIgnoreContactInput = {
  matchKind: EvolutionLeadIgnoreMatchKind;
  value: string;
  label?: string | null;
  note?: string | null;
};

function trimOptional(value: string | null | undefined, max: number): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return raw.slice(0, max);
}

function normalizeLidContactKey(value: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw.toLowerCase().startsWith('lid:')) return null;
  const digits = raw.slice(4).replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `lid:${digits}`;
}

export function normalizeEvolutionLeadIgnoreMatch(
  kind: EvolutionLeadIgnoreMatchKind,
  rawValue: string,
): { matchKind: EvolutionLeadIgnoreMatchKind; matchValue: string } {
  const value = String(rawValue ?? '').trim();
  if (!value) {
    throw new BadRequestException('Informe telefone, chave de contato ou remote Jid.');
  }

  if (kind === 'phone') {
    const phone =
      resolveBrazilMobilePhone(value) ??
      normalizedBrazilMobileKey(value) ??
      (isValidMobilePhone(normalizeMobilePhone(value)) ? normalizeMobilePhone(value) : null);
    if (!phone) {
      throw new BadRequestException('Telefone inválido para a lista de exceção.');
    }
    return { matchKind: 'phone', matchValue: phone };
  }

  if (kind === 'contact_key') {
    if (value.startsWith('group:')) {
      throw new BadRequestException('Grupos não entram na lista de exceção de leads.');
    }
    const lid = normalizeLidContactKey(value);
    if (lid) return { matchKind: 'contact_key', matchValue: lid };
    const asPhone = normalizedBrazilMobileKey(value);
    if (asPhone) return { matchKind: 'phone', matchValue: asPhone };
    const digits = value.replace(/\D/g, '');
    if (digits.length >= 8 && /^\d+$/.test(digits)) {
      const phone = resolveBrazilMobilePhone(digits);
      if (phone) return { matchKind: 'phone', matchValue: phone };
    }
    return { matchKind: 'contact_key', matchValue: value };
  }

  const jid = value.toLowerCase();
  if (!jid.includes('@')) {
    throw new BadRequestException('Remote Jid deve conter «@» (ex.: 5511999999999@s.whatsapp.net).');
  }
  return { matchKind: 'remote_jid', matchValue: jid };
}

@Injectable()
export class EvolutionLeadIgnoreContactsService {
  constructor(
    @InjectRepository(EvolutionLeadIgnoreContact)
    private readonly ignores: Repository<EvolutionLeadIgnoreContact>,
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
  ) {}

  private mapRow(row: EvolutionLeadIgnoreContact): EvolutionLeadIgnoreContactDto {
    return {
      id: row.id,
      instanceId: row.instanceId,
      matchKind: row.matchKind,
      matchValue: row.matchValue,
      label: row.label,
      note: row.note,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async assertInstance(instanceId: string): Promise<void> {
    const exists = await this.instances.exist({ where: { id: instanceId } });
    if (!exists) throw new NotFoundException('Instância não encontrada.');
  }

  async listForInstance(instanceId: string): Promise<EvolutionLeadIgnoreContactDto[]> {
    await this.assertInstance(instanceId);
    const rows = await this.ignores.find({
      where: { instanceId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.mapRow(row));
  }

  async add(
    instanceId: string,
    body: CreateEvolutionLeadIgnoreContactInput,
  ): Promise<EvolutionLeadIgnoreContactDto> {
    await this.assertInstance(instanceId);
    const kind = body.matchKind;
    if (kind !== 'phone' && kind !== 'contact_key' && kind !== 'remote_jid') {
      throw new BadRequestException('Tipo de correspondência inválido.');
    }
    const normalized = normalizeEvolutionLeadIgnoreMatch(kind, body.value);
    const label = trimOptional(body.label, 120);
    const note = trimOptional(body.note, 512);

    const existing = await this.ignores.findOne({
      where: {
        instanceId,
        matchKind: normalized.matchKind,
        matchValue: normalized.matchValue,
      },
    });
    if (existing) {
      existing.label = label ?? existing.label;
      existing.note = note ?? existing.note;
      const saved = await this.ignores.save(existing);
      return this.mapRow(saved);
    }

    const saved = await this.ignores.save(
      this.ignores.create({
        instanceId,
        matchKind: normalized.matchKind,
        matchValue: normalized.matchValue,
        label,
        note,
      }),
    );
    return this.mapRow(saved);
  }

  async remove(instanceId: string, ignoreId: string): Promise<{ ok: true }> {
    await this.assertInstance(instanceId);
    const row = await this.ignores.findOne({ where: { id: ignoreId, instanceId } });
    if (!row) throw new NotFoundException('Exceção não encontrada.');
    await this.ignores.delete({ id: ignoreId });
    return { ok: true };
  }

  private collectInboundIdentityKeys(input: {
    contactKey: string;
    phone?: string | null;
    remoteJid?: string | null;
    extraAliasKeys?: string[];
  }): Set<string> {
    const keys = new Set<string>();
    const add = (raw: string | null | undefined) => {
      const item = String(raw ?? '').trim();
      if (!item) return;
      keys.add(item);
      if (item.includes('@')) keys.add(item.toLowerCase());
    };

    add(input.contactKey);
    add(input.remoteJid);
    for (const alias of input.extraAliasKeys ?? []) add(alias);

    const seeds = [input.contactKey, input.phone, ...(input.extraAliasKeys ?? []), input.remoteJid];
    for (const seed of seeds) {
      const text = String(seed ?? '').trim();
      if (!text) continue;
      const lid = normalizeLidContactKey(text);
      if (lid) {
        keys.add(lid);
        const digits = lid.slice(4);
        keys.add(digits);
      }
      const phone =
        resolveBrazilMobilePhone(text) ??
        normalizedBrazilMobileKey(text) ??
        (isValidMobilePhone(normalizeMobilePhone(text)) ? normalizeMobilePhone(text) : null);
      if (phone) keys.add(phone);
    }

    return keys;
  }

  async isContactIgnored(
    instanceId: string,
    input: {
      contactKey: string;
      phone?: string | null;
      remoteJid?: string | null;
      extraAliasKeys?: string[];
    },
  ): Promise<boolean> {
    const rows = await this.ignores.find({
      where: { instanceId },
      select: ['matchKind', 'matchValue'],
    });
    if (!rows.length) return false;

    const contactKey = String(input.contactKey ?? '').trim();
    const remoteJid = String(input.remoteJid ?? '').trim().toLowerCase();
    const resolvedPhone =
      resolveBrazilMobilePhone(input.phone) ??
      normalizedBrazilMobileKey(contactKey) ??
      null;

  return rows.some((row) => {
      if (row.matchKind === 'phone') {
        return resolvedPhone === row.matchValue;
      }
      if (row.matchKind === 'remote_jid') {
        return Boolean(remoteJid) && remoteJid === row.matchValue;
      }
      const lid = normalizeLidContactKey(contactKey);
      return contactKey === row.matchValue || (lid !== null && lid === row.matchValue);
    });
  }
}
