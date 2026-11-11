import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Department } from '../access-control/department.entity';
import { User } from '../users/user.entity';
import { EvolutionInstance } from './evolution-instance.entity';
import { SystemSettingsService } from '../system-settings/system-settings.service';
import { normalizeEvolutionBaseUrl } from '../system-settings/system-settings.service';
import { EVOLUTION_WEBHOOK_EVENTS } from './evolution-webhook.constants';
import { EvolutionInboundService } from './evolution-inbound.service';
import { EvolutionInboxService } from './evolution-inbox.service';
import { collectEvolutionMessageRows, readEvolutionRowMessageAt } from './evolution-message.parser';

export type EvolutionInstanceDto = {
  id: string;
  name: string;
  instanceKey: string;
  shortId: string;
  baseUrl: string;
  isDefault: boolean;
  active: boolean;
  hasApiKey: boolean;
  usageMode: 'corporate' | 'operational';
  usageModeLabel: string;
  departmentId: string | null;
  departmentName: string | null;
  defaultOwnerUserId: string | null;
  defaultOwnerName: string | null;
  connectedPhone: string | null;
  connectionState: string;
  connected: boolean;
  autoCreateLeads: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type EvolutionOverviewDto = {
  apiOnline: boolean;
  apiMessage: string;
  evolutionInstanceCount: number;
  webhookUrl: string | null;
  instances: EvolutionInstanceDto[];
};

export type CreateEvolutionInstanceInput = {
  name: string;
};

export type UpdateEvolutionInstanceInput = {
  name?: string;
  isDefault?: boolean;
  active?: boolean;
  usageMode?: 'corporate' | 'operational';
  departmentId?: string | null;
  defaultOwnerUserId?: string | null;
  autoCreateLeads?: boolean;
};

const USAGE_LABELS: Record<'corporate' | 'operational', string> = {
  corporate: 'Corporativa',
  operational: 'Operacional',
};

@Injectable()
export class EvolutionInstancesService {
  constructor(
    @InjectRepository(EvolutionInstance)
    private readonly instances: Repository<EvolutionInstance>,
    @InjectRepository(Department)
    private readonly departments: Repository<Department>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly systemSettings: SystemSettingsService,
    private readonly config: ConfigService,
    private readonly inbound: EvolutionInboundService,
    private readonly inbox: EvolutionInboxService,
  ) {}

  private evolutionHeaders(apiKey: string): Record<string, string> {
    return { apikey: apiKey, 'Content-Type': 'application/json' };
  }

  private async buildEvolutionWebhookPayload(): Promise<Record<string, unknown>> {
    const url = await this.systemSettings.resolveEvolutionWebhookUrl();
    if (!url) {
      throw new BadRequestException(
        'Configure a URL pública da API em Sistema → Configurações (webhook WhatsApp). ' +
          'O servidor de integração precisa desse endereço para enviar eventos ao criar a instância.',
      );
    }

    const secret = this.config.get<string>('EVOLUTION_WEBHOOK_SECRET')?.trim();
    const headers = secret ? { 'x-evolution-webhook-secret': secret } : undefined;
    return {
      enabled: true,
      url,
      byEvents: false,
      base64: false,
      events: [...EVOLUTION_WEBHOOK_EVENTS],
      ...(headers ? { headers } : {}),
    };
  }

  /** Aplica URL e eventos de mensagem no webhook da instância na Evolution. */
  private async syncRemoteInstanceWebhook(
    remote: { baseUrl: string; apiKey: string },
    instanceKey: string,
  ): Promise<void> {
    const webhook = await this.buildEvolutionWebhookPayload();
    const endpoint = `${remote.baseUrl}/webhook/set/${encodeURIComponent(instanceKey)}`;
    const body = { webhook };

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: this.evolutionHeaders(remote.apiKey),
        body: JSON.stringify(body),
      });
      if (response.ok || response.status === 201) return;
      const lastError = await response.text();
      throw new BadRequestException(
        `Não foi possível registrar o webhook no servidor para «${instanceKey}»: ${lastError.slice(0, 280)}`,
      );
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const lastError = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `Não foi possível registrar o webhook no servidor para «${instanceKey}»: ${lastError.slice(0, 280)}`,
      );
    }
  }

  private extractRemoteInstanceNames(payload: unknown): string[] {
    const names: string[] = [];
    const pushName = (value: unknown) => {
      if (typeof value !== 'string' || !value.trim()) return;
      names.push(value.trim());
    };

    const visit = (node: unknown) => {
      if (!node) return;
      if (Array.isArray(node)) {
        for (const item of node) visit(item);
        return;
      }
      if (typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      pushName(record.instanceName);
      pushName(record.name);
      if (record.instance && typeof record.instance === 'object') {
        const inst = record.instance as Record<string, unknown>;
        pushName(inst.instanceName);
        pushName(inst.name);
      }
    };

    visit(payload);
    return [...new Set(names)];
  }

  private responseImpliesExistingInstance(status: number, body: string): boolean {
    if (status === 409) return true;
    const normalized = body.toLowerCase();
    return (
      normalized.includes('already exists') ||
      normalized.includes('já existe') ||
      normalized.includes('already in use') ||
      (normalized.includes('instance') && normalized.includes('exist'))
    );
  }

  private formatEvolutionHttpError(status: number, body: string): string {
    const snippet = body.trim().slice(0, 220);
    return snippet
      ? `O servidor respondeu ${status}: ${snippet}`
      : `O servidor respondeu ${status}.`;
  }

  private async remoteInstanceExists(
    remote: { baseUrl: string; apiKey: string },
    instanceKey: string,
  ): Promise<boolean> {
    const headers = { apikey: remote.apiKey };
    try {
      const stateUrl = `${remote.baseUrl}/instance/connectionState/${encodeURIComponent(instanceKey)}`;
      const stateRes = await fetch(stateUrl, { headers });
      if (stateRes.ok) return true;
      if (stateRes.status !== 404) {
        const listUrl = `${remote.baseUrl}/instance/fetchInstances`;
        const listRes = await fetch(listUrl, { headers });
        if (listRes.ok) {
          const payload = (await listRes.json()) as unknown;
          return this.extractRemoteInstanceNames(payload).includes(instanceKey);
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  private async createRemoteInstance(
    remote: { baseUrl: string; apiKey: string },
    instanceKey: string,
  ): Promise<void> {
    const exists = await this.remoteInstanceExists(remote, instanceKey);
    const webhookBlock = await this.buildEvolutionWebhookPayload();

    if (!exists) {
      const body: Record<string, unknown> = {
        instanceName: instanceKey,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: false,
      };
      if (webhookBlock) {
        body.webhook = webhookBlock;
      }

      const url = `${remote.baseUrl}/instance/create`;
      const response = await fetch(url, {
        method: 'POST',
        headers: this.evolutionHeaders(remote.apiKey),
        body: JSON.stringify(body),
      });

      if (!response.ok && response.status !== 201) {
        const text = await response.text();
        if (!this.responseImpliesExistingInstance(response.status, text)) {
          if (response.status === 400 && text.toLowerCase().includes('integration')) {
            const legacy = await fetch(url, {
              method: 'POST',
              headers: this.evolutionHeaders(remote.apiKey),
              body: JSON.stringify({
                instanceName: instanceKey,
                qrcode: false,
                ...(webhookBlock ? { webhook: webhookBlock } : {}),
              }),
            });
            if (legacy.ok || legacy.status === 201) {
              await this.syncRemoteInstanceWebhook(remote, instanceKey);
              return;
            }
            const legacyText = await legacy.text();
            if (this.responseImpliesExistingInstance(legacy.status, legacyText)) {
              await this.syncRemoteInstanceWebhook(remote, instanceKey);
              return;
            }
            throw new BadRequestException(this.formatEvolutionHttpError(legacy.status, legacyText));
          }
          throw new BadRequestException(this.formatEvolutionHttpError(response.status, text));
        }
      }
    }

    await this.syncRemoteInstanceWebhook(remote, instanceKey);
  }

  private async deleteRemoteInstance(
    remote: { baseUrl: string; apiKey: string },
    instanceKey: string,
  ): Promise<{ ok: boolean; message?: string }> {
    const encoded = encodeURIComponent(instanceKey);
    const url = `${remote.baseUrl}/instance/delete/${encoded}`;
    const headers = this.evolutionHeaders(remote.apiKey);

    const tryRequest = async (method: 'DELETE' | 'POST') => {
      const response = await fetch(url, { method, headers });
      if (response.ok || response.status === 404) return { ok: true as const };
      const text = await response.text();
      return { ok: false as const, message: this.formatEvolutionHttpError(response.status, text) };
    };

    try {
      let result = await tryRequest('DELETE');
      if (!result.ok) {
        result = await tryRequest('POST');
      }
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Falha ao contactar o servidor de integração.',
      };
    }
  }

  private async resolvePlatformApi(): Promise<{ baseUrl: string; apiKey: string }> {
    const platform = await this.systemSettings.readEvolutionPlatformConfig();
    const baseUrl = normalizeEvolutionBaseUrl(platform.baseUrl || '');
    const apiKey = String(platform.apiKey || '').trim();
    if (!baseUrl) {
      throw new BadRequestException('Configure a URL do servidor WhatsApp em Sistema → Configurações.');
    }
    if (!apiKey) {
      throw new BadRequestException('Configure a chave de integração WhatsApp em Sistema → Configurações.');
    }
    return { baseUrl, apiKey };
  }

  private async resolveRemoteApi(
    row: EvolutionInstance,
  ): Promise<{ baseUrl: string; apiKey: string }> {
    const platform = await this.systemSettings.readEvolutionPlatformConfig();
    const baseUrl = normalizeEvolutionBaseUrl(platform.baseUrl || row.baseUrl || '');
    const apiKey = String(platform.apiKey || row.apiKey || '').trim();
    if (!apiKey) {
      throw new BadRequestException('Configure a chave de integração WhatsApp em Sistema → Configurações.');
    }
    return { baseUrl, apiKey };
  }

  /** Testa apenas reachability + chave global (não exige instância WhatsApp conectada). */
  async testPlatformConnection(): Promise<{ ok: boolean; message?: string }> {
    let remote: { baseUrl: string; apiKey: string };
    try {
      remote = await this.resolvePlatformApi();
    } catch (err) {
      const message =
        err instanceof BadRequestException
          ? String(err.message)
          : 'Configure URL e chave de integração WhatsApp em Sistema → Configurações.';
      return { ok: false, message };
    }

    const headers = { apikey: remote.apiKey };
    const paths = ['/instance/fetchInstances', '/'];

    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      const url = path === '/' ? remote.baseUrl : `${remote.baseUrl}${path}`;
      try {
        const response = await fetch(url, { headers });
        if (response.status === 401 || response.status === 403) {
          return { ok: false, message: 'Servidor acessível, mas a chave de integração foi recusada.' };
        }
        if (response.ok) {
          return { ok: true, message: 'Servidor de integração acessível com a chave configurada.' };
        }
        const body = await response.text();
        const isLast = index === paths.length - 1;
        if (!isLast && (response.status === 404 || response.status === 405)) {
          continue;
        }
        return {
          ok: false,
          message: `O servidor respondeu ${response.status}: ${body.slice(0, 160)}`,
        };
      } catch (err) {
        const isLast = index === paths.length - 1;
        if (!isLast) continue;
        return {
          ok: false,
          message: err instanceof Error ? err.message : 'Falha ao contactar o servidor de integração.',
        };
      }
    }

    return { ok: false, message: 'Falha ao contactar o servidor de integração.' };
  }

  private normalizeKey(key: string): string {
    const trimmed = key.trim();
    if (!trimmed) throw new BadRequestException('Informe o nome da instância.');
    if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
      throw new BadRequestException(
        'O nome da instância só pode conter letras, números, ponto, hífen e sublinhado.',
      );
    }
    return trimmed;
  }

  private shortId(id: string): string {
    return `wa-${id.replace(/-/g, '').slice(0, 8)}`;
  }

  private isConnectedState(state: string | null | undefined): boolean {
    const normalized = String(state ?? '').toLowerCase();
    return normalized === 'open' || normalized === 'connected' || normalized === 'online';
  }

  private extractStateFromPayload(payload: Record<string, unknown>): string {
    const read = (value: unknown): string | null => {
      if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
      if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const nested = record.state ?? record.status;
        if (typeof nested === 'string' && nested.trim()) return nested.trim().toLowerCase();
      }
      return null;
    };

    const instance = payload.instance as Record<string, unknown> | undefined;
    return (
      read(instance?.state) ??
      read(instance?.status) ??
      read(instance?.connectionStatus) ??
      read(payload.state) ??
      read(payload.status) ??
      read(payload.connectionStatus) ??
      'unknown'
    );
  }

  private formatPhoneFromOwner(raw: unknown): string | null {
    if (raw == null || raw === '') return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < 10) return null;
    if (digits.length >= 12 && digits.startsWith('55')) return `+${digits}`;
    return `+55${digits}`;
  }

  private flattenFetchInstances(payload: unknown): Record<string, unknown>[] {
    if (Array.isArray(payload)) {
      return payload.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
    }
    if (!payload || typeof payload !== 'object') return [];
    const record = payload as Record<string, unknown>;
    for (const key of ['instances', 'instance', 'data', 'response']) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        return nested.filter((row) => row && typeof row === 'object') as Record<string, unknown>[];
      }
    }
    return [];
  }

  private remoteInstanceName(item: Record<string, unknown>): string {
    return String(item.instanceName ?? item.name ?? '').trim();
  }

  private async fetchRemoteInstanceMeta(
    remote: { baseUrl: string; apiKey: string },
    instanceKey: string,
  ): Promise<{ ownerJid?: string; profileName?: string; status?: string } | null> {
    try {
      const url = `${remote.baseUrl}/instance/fetchInstances`;
      const response = await fetch(url, { headers: { apikey: remote.apiKey } });
      if (!response.ok) return null;
      const payload = (await response.json()) as unknown;
      const match = this.flattenFetchInstances(payload).find(
        (row) => this.remoteInstanceName(row) === instanceKey,
      );
      if (!match) return null;
      const statusRaw = match.connectionStatus ?? match.status ?? match.state;
      return {
        ownerJid: String(match.ownerJid ?? match.owner ?? match.number ?? '') || undefined,
        profileName: String(match.profileName ?? '') || undefined,
        status: typeof statusRaw === 'string' ? statusRaw : undefined,
      };
    } catch {
      return null;
    }
  }

  /** Atualiza estado e número a partir da Evolution (connectionState + fetchInstances). */
  private async refreshConnectionRow(
    row: EvolutionInstance,
    persist: boolean,
  ): Promise<{ ok: boolean; state?: string; message?: string }> {
    const remote = await this.resolveRemoteApi(row);
    const url = `${remote.baseUrl}/instance/connectionState/${encodeURIComponent(row.instanceKey)}`;

    try {
      const response = await fetch(url, { headers: { apikey: remote.apiKey } });
      if (!response.ok) {
        const body = await response.text();
        return {
          ok: false,
          message: `O servidor respondeu ${response.status}: ${body.slice(0, 160)}`,
        };
      }

      const payload = (await response.json()) as Record<string, unknown>;
      let state = this.extractStateFromPayload(payload);

      let owner =
        (payload.instance as Record<string, unknown> | undefined)?.owner ??
        payload.owner ??
        (payload.instance as Record<string, unknown> | undefined)?.ownerJid ??
        payload.ownerJid;

      const meta = await this.fetchRemoteInstanceMeta(remote, row.instanceKey);
      if (meta?.status && state === 'unknown') {
        state = meta.status.toLowerCase();
      }
      if (!owner && meta?.ownerJid) owner = meta.ownerJid;

      if (persist) {
        const previous = String(row.connectionState ?? '').trim().toLowerCase();
        const phone = this.formatPhoneFromOwner(owner);
        const patch: Partial<EvolutionInstance> = { connectionState: state };
        if (phone) patch.connectedPhone = phone;
        await this.instances.update(row.id, patch);
        row.connectionState = state;
        if (phone) row.connectedPhone = phone;
        if (this.isConnectedState(state) && !this.isConnectedState(previous)) {
          this.inbox.queueInboxBootstrapAfterConnect(row.id, { force: true });
        }
      }

      return { ok: true, state };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Falha ao contactar o servidor de integração.',
      };
    }
  }

  private async syncActiveInstancesFromEvolution(): Promise<void> {
    const rows = await this.instances.find({
      where: { active: true },
      select: ['id'],
    });
    await Promise.all(
      rows.map(async (stub) => {
        try {
          const row = await this.findWithSecret(stub.id);
          await this.refreshConnectionRow(row, true);
        } catch {
          // ignora instância removida ou indisponível
        }
      }),
    );
  }

  private toDto(
    row: EvolutionInstance,
    context?: { departmentName?: string | null; ownerName?: string | null },
  ): EvolutionInstanceDto {
    return {
      id: row.id,
      name: row.name,
      instanceKey: row.instanceKey,
      shortId: this.shortId(row.id),
      baseUrl: row.baseUrl,
      isDefault: row.isDefault,
      active: row.active,
      hasApiKey: Boolean(row.apiKey),
      usageMode: row.usageMode,
      usageModeLabel: USAGE_LABELS[row.usageMode] ?? row.usageMode,
      departmentId: row.departmentId,
      departmentName: context?.departmentName ?? null,
      defaultOwnerUserId: row.defaultOwnerUserId,
      defaultOwnerName: context?.ownerName ?? null,
      connectedPhone: row.connectedPhone,
      connectionState: row.connectionState,
      connected: row.active && this.isConnectedState(row.connectionState),
      autoCreateLeads: row.autoCreateLeads,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private async relationMaps(rows: EvolutionInstance[]) {
    const departmentIds = [...new Set(rows.map((row) => row.departmentId).filter(Boolean))] as string[];
    const ownerIds = [...new Set(rows.map((row) => row.defaultOwnerUserId).filter(Boolean))] as string[];

    const departmentRows = departmentIds.length
      ? await this.departments.find({ where: { id: In(departmentIds) }, select: ['id', 'name'] })
      : [];
    const ownerRows = ownerIds.length
      ? await this.users.find({ where: { id: In(ownerIds) }, select: ['id', 'name'] })
      : [];

    const departmentMap = new Map(departmentRows.map((row) => [row.id, row.name]));
    const ownerMap = new Map(ownerRows.map((row) => [row.id, row.name]));

    return { departmentMap, ownerMap };
  }

  private async mapToDtos(rows: EvolutionInstance[]): Promise<EvolutionInstanceDto[]> {
    const { departmentMap, ownerMap } = await this.relationMaps(rows);
    return rows.map((row) =>
      this.toDto(row, {
        departmentName: row.departmentId ? departmentMap.get(row.departmentId) ?? null : null,
        ownerName: row.defaultOwnerUserId ? ownerMap.get(row.defaultOwnerUserId) ?? null : null,
      }),
    );
  }

  private listSelect(): (keyof EvolutionInstance)[] {
    return [
      'id',
      'name',
      'instanceKey',
      'baseUrl',
      'isDefault',
      'active',
      'apiKey',
      'usageMode',
      'departmentId',
      'defaultOwnerUserId',
      'connectedPhone',
      'connectionState',
      'autoCreateLeads',
      'createdAt',
      'updatedAt',
    ];
  }

  private slugFromName(name: string): string {
    const slug = name
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return slug || 'instancia';
  }

  private async allocateInstanceKey(name: string): Promise<string> {
    const base = this.slugFromName(name);
    let candidate = `wa-${base}`;
    let suffix = 1;

    while (await this.instances.findOne({ where: { instanceKey: candidate }, select: ['id'] })) {
      suffix += 1;
      candidate = `wa-${base}-${suffix}`;
      if (suffix > 99) {
        candidate = `wa-${base}-${Math.random().toString(36).slice(2, 8)}`;
        break;
      }
    }

    this.normalizeKey(candidate);
    return candidate;
  }

  private async clearOtherDefaults(exceptId?: string) {
    const rows = await this.instances.find({ where: { isDefault: true } });
    for (const row of rows) {
      if (exceptId && row.id === exceptId) continue;
      row.isDefault = false;
      await this.instances.save(row);
    }
  }

  async getConnectionStatus(): Promise<{
    hasConnected: boolean;
    connectedCount: number;
    activeCount: number;
  }> {
    const rows = await this.instances.find({
      where: { active: true },
      select: ['id', 'connectionState'],
    });
    const connectedCount = rows.filter((row) => this.isConnectedState(row.connectionState)).length;
    return {
      hasConnected: connectedCount > 0,
      connectedCount,
      activeCount: rows.length,
    };
  }

  async list(all = false): Promise<EvolutionInstanceDto[]> {
    const rows = await this.instances.find({
      where: all ? {} : { active: true },
      order: { isDefault: 'DESC', name: 'ASC' },
      select: this.listSelect(),
    });
    return this.mapToDtos(rows);
  }

  async overview(): Promise<EvolutionOverviewDto> {
    const test = await this.testPlatformConnection();
    if (test.ok) {
      await this.syncActiveInstancesFromEvolution();
    }
    const instances = await this.list(true);
    const activeCount = instances.filter((row) => row.active).length;
    const baseMessage =
      test.message ??
      (test.ok ? 'Servidor de integração acessível.' : 'Falha ao contactar o servidor de integração.');
    const apiMessage =
      test.ok && activeCount > 0
        ? `${baseMessage} · ${activeCount} instância(s) cadastrada(s).`
        : baseMessage;

  const webhookUrl = await this.systemSettings.resolveEvolutionWebhookUrl();

    return {
      apiOnline: test.ok,
      apiMessage,
      evolutionInstanceCount: activeCount,
      webhookUrl,
      instances,
    };
  }

  async getById(id: string): Promise<EvolutionInstanceDto> {
    const row = await this.instances.findOne({
      where: { id },
      select: this.listSelect(),
    });
    if (!row) throw new NotFoundException('Instância não encontrada.');
    const [dto] = await this.mapToDtos([row]);
    return dto;
  }

  private async findWithSecret(id: string): Promise<EvolutionInstance> {
    const row = await this.instances.findOne({
      where: { id },
      select: [
        'id',
        'name',
        'instanceKey',
        'baseUrl',
        'apiKey',
        'isDefault',
        'active',
        'usageMode',
        'departmentId',
        'defaultOwnerUserId',
        'connectedPhone',
        'connectionState',
        'autoCreateLeads',
        'createdAt',
        'updatedAt',
      ],
    });
    if (!row) throw new NotFoundException('Instância não encontrada.');
    return row;
  }

  async create(body: CreateEvolutionInstanceInput): Promise<EvolutionInstanceDto> {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('Informe um nome amigável para a instância.');

    const remote = await this.resolvePlatformApi();
    const instanceKey = await this.allocateInstanceKey(name);
    await this.createRemoteInstance(remote, instanceKey);
    const baseUrl = remote.baseUrl;

    const instance = this.instances.create({
      name,
      instanceKey,
      baseUrl,
      apiKey: remote.apiKey,
      isDefault: false,
      active: true,
      usageMode: 'corporate',
      departmentId: null,
      defaultOwnerUserId: null,
      autoCreateLeads: true,
    });

    const saved = await this.instances.save(instance);
    if (saved.isDefault) await this.clearOtherDefaults(saved.id);
    return this.getById(saved.id);
  }

  async update(id: string, body: UpdateEvolutionInstanceInput): Promise<EvolutionInstanceDto> {
    const row = await this.findWithSecret(id);

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) throw new BadRequestException('Informe um nome para a instância.');
      row.name = name;
    }
    if (body.active !== undefined) row.active = body.active;
    if (body.isDefault !== undefined) row.isDefault = body.isDefault;
    if (body.usageMode !== undefined) row.usageMode = body.usageMode;
    if (body.departmentId !== undefined) row.departmentId = body.departmentId;
    if (body.defaultOwnerUserId !== undefined) row.defaultOwnerUserId = body.defaultOwnerUserId;
    if (body.autoCreateLeads !== undefined) row.autoCreateLeads = body.autoCreateLeads;

    await this.instances.save(row);
    if (row.isDefault) await this.clearOtherDefaults(row.id);
    return this.getById(id);
  }

  async remove(id: string): Promise<{ ok: true; warning?: string }> {
    const row = await this.findWithSecret(id);
    const remote = await this.resolveRemoteApi(row);
    const deleted = await this.deleteRemoteInstance(remote, row.instanceKey);
    await this.instances.remove(row);
    if (!deleted.ok) {
      return {
        ok: true,
        warning: `Removida no ACAF, mas o servidor remoto ainda tem a instância «${row.instanceKey}». ${deleted.message ?? 'Exclua no servidor ou use outro nome ao recriar.'}`,
      };
    }
    return { ok: true };
  }

  async testConnection(
    id: string,
    options?: { persist?: boolean },
  ): Promise<{ ok: boolean; state?: string; message?: string }> {
    const row = await this.findWithSecret(id);
    return this.refreshConnectionRow(row, options?.persist !== false);
  }

  async refreshConnection(id: string): Promise<EvolutionInstanceDto> {
    const row = await this.findWithSecret(id);
    const remote = await this.resolveRemoteApi(row);
    await this.syncRemoteInstanceWebhook(remote, row.instanceKey);
    const result = await this.testConnection(id, { persist: true });
    if (!result.ok) {
      throw new BadRequestException(result.message ?? 'Não foi possível atualizar o status da instância.');
    }
    if (this.isConnectedState(result.state ?? row.connectionState)) {
      this.inbox.queueInboxBootstrapAfterConnect(id, { force: true });
    }
    return this.getById(id);
  }

  async connect(
    id: string,
  ): Promise<{
    ok: boolean;
    pairingCode?: string;
    code?: string;
    qrPayload?: string;
    qrcode?: string;
    message?: string;
  }> {
    const row = await this.findWithSecret(id);
    const remote = await this.resolveRemoteApi(row);
    await this.createRemoteInstance(remote, row.instanceKey);
    const url = `${remote.baseUrl}/instance/connect/${encodeURIComponent(row.instanceKey)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { apikey: remote.apiKey },
      });

      const body = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          message: `O servidor respondeu ${response.status}: ${body.slice(0, 200)}`,
        };
      }

      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        return { ok: true, message: body.slice(0, 200) };
      }

      const nestedQr = payload.qrcode;
      const nestedRecord =
        nestedQr && typeof nestedQr === 'object' ? (nestedQr as Record<string, unknown>) : null;

      const qrImageCandidate = [
        payload.base64,
        nestedRecord?.base64,
        typeof nestedQr === 'string' && nestedQr.startsWith('data:image') ? nestedQr : null,
        typeof nestedQr === 'string' &&
        !nestedQr.startsWith('2@') &&
        /^[A-Za-z0-9+/=]+$/.test(nestedQr.slice(0, 64))
          ? nestedQr
          : null,
      ].find((value) => typeof value === 'string' && value.trim().length > 0);
      const qrImageRaw = qrImageCandidate ? String(qrImageCandidate) : '';

      const whatsappPayload = String(nestedRecord?.code ?? payload.code ?? '');
      const numericPairing = String(
        nestedRecord?.pairingCode ?? payload.pairingCode ?? '',
      ).trim();

      const isWhatsAppQrPayload = (value: string) =>
        value.startsWith('2@') || (value.includes('/') && value.length > 40);

      const qrPayload = isWhatsAppQrPayload(whatsappPayload) ? whatsappPayload : undefined;
      const pairingCode =
        numericPairing && numericPairing !== whatsappPayload
          ? numericPairing
          : isWhatsAppQrPayload(whatsappPayload)
            ? undefined
            : whatsappPayload || numericPairing || undefined;

      await this.refreshConnectionRow(row, true);

      return {
        ok: true,
        qrcode: qrImageRaw || undefined,
        qrPayload,
        code: qrPayload ?? pairingCode,
        pairingCode,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : 'Falha ao solicitar conexão.',
      };
    }
  }

  async syncInbox(id: string): Promise<{
    ok: boolean;
    imported: number;
    total: number;
    webhookUrl: string | null;
    avatarsSynced?: number;
    avatarsStored?: number;
    mediaStored?: { processed: number; stored: number; skipped: number; failed: number };
    message?: string;
  }> {
    const row = await this.findWithSecret(id);
    const remote = await this.resolveRemoteApi(row);
    const webhookUrl = await this.systemSettings.resolveEvolutionWebhookUrl();

    try {
      await this.syncRemoteInstanceWebhook(remote, row.instanceKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, imported: 0, total: 0, webhookUrl, message };
    }

    const watermark = await this.inbox.getInstanceLatestMessageAt(row.id);
    const payload = await this.fetchRemoteChatMessages(remote, row.instanceKey, watermark);
    const rowCount = collectEvolutionMessageRows(payload).length;
    if (!rowCount) {
      return {
        ok: true,
        imported: 0,
        total: 0,
        webhookUrl,
        message: 'O servidor não retornou mensagens. Envie um teste ou aguarde o webhook.',
      };
    }

    const { imported, total } = await this.inbound.ingestMessagePayload(row.id, payload);
    const mediaPatched = await this.inbox.backfillMessageMediaFromPayload(row.id, payload);
    await this.inbox.applyPushNamesFromPayload(row.id, payload);
    await this.inbox.syncChatArchiveFromRemote(row.id).catch(() => 0);
    await this.inbox.backfillLidThreadsFromStoredPayloads(row.id).catch(() => 0);
    const { avatars, avatarsStored, updated: namesUpdated } =
      await this.inbox.syncContactNamesFromEvolution(row.id);
    const mediaStored = await this.inbox.syncMessageMediaToStorage(row.id, 500);
    return {
      ok: true,
      imported,
      total,
      webhookUrl,
      avatarsSynced: avatars,
      avatarsStored,
      mediaStored,
      message: [
        rowCount > 0
          ? watermark
            ? `${rowCount} mensagem(ns) nova(s) ou alterada(s) desde o último histórico local.`
            : `${rowCount} mensagem(ns) analisada(s) no WhatsApp (inclui grupos e retroativo).`
          : null,
        mediaPatched > 0 ? `${mediaPatched} mensagem(ns) com mídia atualizada.` : null,
        mediaStored.stored > 0
          ? `${mediaStored.stored} mídia(s) copiada(s) para o Nextcloud (exibição sem depender do WhatsApp).`
          : mediaStored.processed > 0
            ? `${mediaStored.processed} mídia(s) tentadas; nenhuma nova no storage (servidor indisponível ou já salvas).`
            : null,
        namesUpdated ? `${namesUpdated} conversa(s) com nome atualizado.` : null,
        avatarsStored > 0
          ? `${avatarsStored} avatar(es) copiado(s) do WhatsApp e salvos no storage (independe da conexão).`
          : avatars > 0
            ? `${avatars} foto(s) no WhatsApp, mas não gravou no Nextcloud — confira NEXTCLOUD_* e permissões.`
            : 'Avatares: WhatsApp não devolveu foto (privacidade/LID é comum).',
      ]
        .filter(Boolean)
        .join(' '),
    };
  }

  /** Reparo automático: só mensagens mais novas que o watermark local (sem sync manual). */
  async repairInboxIncremental(id: string): Promise<number> {
    const row = await this.findWithSecret(id);
    try {
      const remote = await this.resolveRemoteApi(row);
      const watermark = await this.inbox.getInstanceLatestMessageAt(row.id);
      const payload = await this.fetchRemoteChatMessages(remote, row.instanceKey, watermark);
      const rowCount = collectEvolutionMessageRows(payload).length;
      if (!rowCount) return 0;
      const { imported } = await this.inbound.ingestMessagePayload(row.id, payload);
      await this.inbox.applyPushNamesFromPayload(row.id, payload).catch(() => 0);
      return imported;
    } catch {
      return 0;
    }
  }

  async syncMessageMedia(id: string): Promise<{
    ok: boolean;
    processed: number;
    stored: number;
    skipped: number;
    failed: number;
    message: string;
  }> {
    const row = await this.findWithSecret(id);
    if (!row) throw new NotFoundException('Instância não encontrada.');

    const outcome = await this.inbox.syncMessageMediaToStorage(row.id, 800);
    const parts = [
      `${outcome.processed} mídia(s) processada(s).`,
      outcome.stored > 0
        ? `${outcome.stored} gravada(s) no Nextcloud.`
        : 'Nenhuma nova mídia gravada.',
      outcome.failed > 0 ? `${outcome.failed} falha(s) — confira servidor de integração e NEXTCLOUD_*.` : null,
      outcome.skipped > 0 ? `${outcome.skipped} sem payload para baixar.` : null,
    ].filter(Boolean);

    return {
      ok: true,
      ...outcome,
      message: parts.join(' '),
    };
  }

  async syncAvatars(id: string): Promise<{
    ok: boolean;
    checked: number;
    updated: number;
    unchanged: number;
    missing: number;
    message: string;
  }> {
    const row = await this.findWithSecret(id);
    if (!row) throw new NotFoundException('Instância não encontrada.');

    const outcome = await this.inbox.refreshContactAvatars(row.id);
    const parts = [
      `${outcome.checked} contato(s) verificado(s).`,
      outcome.updated > 0
        ? `${outcome.updated} foto(s) nova(s) ou alterada(s) gravada(s) no storage.`
        : 'Nenhuma foto nova para gravar.',
      outcome.unchanged > 0 ? `${outcome.unchanged} inalterada(s).` : null,
      outcome.missing > 0 ? `${outcome.missing} sem foto no WhatsApp.` : null,
    ].filter(Boolean);

    return {
      ok: true,
      ...outcome,
      message: parts.join(' '),
    };
  }

  private async fetchRemoteChatMessages(
    remote: { baseUrl: string; apiKey: string },
    instanceKey: string,
    localWatermark?: Date | null,
  ): Promise<unknown> {
    const endpoint = `${remote.baseUrl}/chat/findMessages/${encodeURIComponent(instanceKey)}`;
    const pageSize = 100;
    const deltaSince =
      localWatermark && !Number.isNaN(localWatermark.getTime())
        ? new Date(localWatermark.getTime() - 120_000)
        : null;
    const maxPages = deltaSince ? 6 : 20;
    const merged: unknown[] = [];
    const seenIds = new Set<string>();
    let lastError = '';

    const mergeRows = (data: unknown) => {
      for (const row of collectEvolutionMessageRows(data)) {
        if (!row || typeof row !== 'object') continue;
        if (deltaSince) {
          const at = readEvolutionRowMessageAt(row);
          if (at && at.getTime() < deltaSince.getTime()) continue;
        }
        const key = ((row as Record<string, unknown>).key ?? {}) as Record<string, unknown>;
        const id = String(key.id ?? (row as Record<string, unknown>).id ?? '').trim();
        const dedupeKey = id || JSON.stringify(row).slice(0, 120);
        if (seenIds.has(dedupeKey)) continue;
        seenIds.add(dedupeKey);
        merged.push(row);
      }
    };

    for (let page = 1; page <= maxPages; page += 1) {
      const bodies: Record<string, unknown>[] = [
        { where: {}, limit: pageSize, page, sort: { messageTimestamp: -1 } },
        { where: {}, limit: pageSize, page, sort: -1 },
        { where: {}, limit: pageSize, page },
        { where: {}, take: pageSize, skip: (page - 1) * pageSize },
        { where: {}, offset: (page - 1) * pageSize, limit: pageSize },
      ];
      let pageRows = 0;
      for (const body of bodies) {
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: this.evolutionHeaders(remote.apiKey),
            body: JSON.stringify(body),
          });
          const text = await response.text();
          if (!response.ok) {
            lastError = `${response.status}: ${text.slice(0, 200)}`;
            continue;
          }
          let payload: unknown = {};
          try {
            payload = JSON.parse(text);
          } catch {
            lastError = 'Resposta inválida do servidor.';
            continue;
          }
          const record =
            payload && typeof payload === 'object'
              ? ((payload as Record<string, unknown>).messages ?? payload)
              : payload;
          const before = merged.length;
          mergeRows(record);
          pageRows = merged.length - before;
          if (pageRows > 0) break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
        }
      }
      if (pageRows === 0) break;
      if (pageRows < pageSize) break;
    }

    if (merged.length) return { messages: merged };
    throw new BadRequestException(
      `Não foi possível buscar mensagens no servidor (${lastError || 'erro desconhecido'}).`,
    );
  }
}
