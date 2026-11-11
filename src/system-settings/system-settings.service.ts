import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getDomain } from '../partner/store';
import { getSystemSetting, patchSystemSettingCache, setSystemSettingsCache } from './system-settings-cache';
import { SystemSetting } from './system-setting.entity';

export const EVOLUTION_INBOUND_WEBHOOK_PATH = '/api/public/evolution/webhook';

export const SYSTEM_SETTING_KEYS = {
  connectFeePercent: 'connectFeePercent',
  dailyFeePercent: 'dailyFeePercent',
  evolutionApiBaseUrl: 'evolutionApiBaseUrl',
  evolutionApiKey: 'evolutionApiKey',
  apiPublicBaseUrl: 'apiPublicBaseUrl',
} as const;

export type EvolutionPlatformConfig = {
  baseUrl: string;
  apiKey: string;
};

export type SystemSettingsAdminSnapshot = {
  connectFeePercent: number;
  dailyFeePercent: number;
  evolutionApiBaseUrl: string;
  evolutionApiKeySet: boolean;
  apiPublicBaseUrl: string;
  evolutionWebhookUrl: string;
};

export function normalizeEvolutionBaseUrl(raw: string): string {
  const trimmed = String(raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    throw new BadRequestException('Informe a URL base da integração WhatsApp.');
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new BadRequestException('A URL deve começar com http:// ou https://.');
  }
  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) {
      throw new Error('protocol');
    }
  } catch {
    throw new BadRequestException('URL da integração inválida. Verifique o endereço e tente de novo.');
  }
  return trimmed;
}

export function parseFeePercent(raw: string | null | undefined, fallback: number): number {
  const n = Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, n));
}

export function getConnectFeePercentFromMemory(): number {
  const mem = getSystemSetting(SYSTEM_SETTING_KEYS.connectFeePercent);
  if (mem != null && mem !== '') return parseFeePercent(mem, 20);
  const domain = getDomain() as { connectFeePercent?: number };
  return parseFeePercent(String(domain.connectFeePercent ?? 20), 20);
}

export function getDailyFeePercentFromMemory(): number {
  const mem = getSystemSetting(SYSTEM_SETTING_KEYS.dailyFeePercent);
  if (mem != null && mem !== '') return parseFeePercent(mem, getConnectFeePercentFromMemory());
  return getConnectFeePercentFromMemory();
}

@Injectable()
export class SystemSettingsService implements OnModuleInit {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly settings: Repository<SystemSetting>,
  ) {}

  async onModuleInit() {
    await this.ensureTable();
    await this.migrateFromConnectDomainFile();
    await this.reloadCache();
  }

  private async ensureTable() {
    await this.settings.manager.query(`
      CREATE TABLE IF NOT EXISTS acaf_system_settings (
        \`key\` varchar(80) NOT NULL,
        \`value\` text NOT NULL,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  private async migrateFromConnectDomainFile() {
    const domain = getDomain() as Record<string, unknown>;
    const feeDefault = String(domain.connectFeePercent ?? 20);
    const defaults: Array<[string, string]> = [
      [SYSTEM_SETTING_KEYS.connectFeePercent, feeDefault],
      [SYSTEM_SETTING_KEYS.dailyFeePercent, String(domain.dailyFeePercent ?? feeDefault)],
      [SYSTEM_SETTING_KEYS.evolutionApiBaseUrl, String(domain.evolutionApiBaseUrl ?? '').trim()],
      [SYSTEM_SETTING_KEYS.evolutionApiKey, String(domain.evolutionApiKey ?? '').trim()],
    ];

    for (const [key, value] of defaults) {
      const existing = await this.get(key);
      if (existing != null) continue;
      const isFee =
        key === SYSTEM_SETTING_KEYS.connectFeePercent || key === SYSTEM_SETTING_KEYS.dailyFeePercent;
      if (isFee || value) {
        await this.setRaw(key, value);
      }
    }
  }

  async reloadCache() {
    const rows = await this.settings.find();
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }
    setSystemSettingsCache(map);
  }

  async get(key: string): Promise<string | null> {
    const row = await this.settings.findOne({ where: { key } });
    return row?.value ?? null;
  }

  private async setRaw(key: string, value: string) {
    await this.settings.save(
      this.settings.create({
        key,
        value: String(value ?? ''),
      }),
    );
    patchSystemSettingCache(key, String(value ?? ''));
  }

  async set(key: string, value: string): Promise<void> {
    await this.setRaw(key, String(value ?? '').trim());
  }

  async getAdminSnapshot(): Promise<SystemSettingsAdminSnapshot> {
    const connectFeePercent = parseFeePercent(
      await this.get(SYSTEM_SETTING_KEYS.connectFeePercent),
      20,
    );
    const dailyFeePercent = parseFeePercent(
      await this.get(SYSTEM_SETTING_KEYS.dailyFeePercent),
      connectFeePercent,
    );

    const urlRaw = (await this.get(SYSTEM_SETTING_KEYS.evolutionApiBaseUrl))?.trim() ?? '';
    let evolutionApiBaseUrl = '';
    if (urlRaw) {
      try {
        evolutionApiBaseUrl = normalizeEvolutionBaseUrl(urlRaw);
      } catch {
        evolutionApiBaseUrl = urlRaw.replace(/\/+$/, '');
      }
    }

    const apiKey = (await this.get(SYSTEM_SETTING_KEYS.evolutionApiKey))?.trim() ?? '';
    const apiPublicBaseUrl = (await this.get(SYSTEM_SETTING_KEYS.apiPublicBaseUrl))?.trim() ?? '';
    const evolutionWebhookUrl = (await this.resolveEvolutionWebhookUrl()) ?? '';

    return {
      connectFeePercent,
      dailyFeePercent,
      evolutionApiBaseUrl,
      evolutionApiKeySet: Boolean(apiKey),
      apiPublicBaseUrl,
      evolutionWebhookUrl,
    };
  }

  /** URL que a Evolution deve chamar (webhook global das instâncias). */
  async resolveEvolutionWebhookUrl(): Promise<string | null> {
    const fromDb = (await this.get(SYSTEM_SETTING_KEYS.apiPublicBaseUrl))?.trim();
    const fromEnv =
      process.env.API_PUBLIC_URL?.trim() || process.env.ACAF_API_PUBLIC_URL?.trim() || '';
    const base = fromDb || fromEnv;
    if (!base) return null;

    const normalizedBase = base.replace(/\/+$/, '');
    const suffix = EVOLUTION_INBOUND_WEBHOOK_PATH;
    if (normalizedBase.endsWith(suffix)) return normalizedBase;
    return `${normalizedBase}${suffix}`;
  }

  async readEvolutionPlatformConfig(): Promise<EvolutionPlatformConfig> {
    const urlRaw = await this.get(SYSTEM_SETTING_KEYS.evolutionApiBaseUrl);
    const apiKey = (await this.get(SYSTEM_SETTING_KEYS.evolutionApiKey)) ?? '';
    const baseUrl = urlRaw?.trim() ? normalizeEvolutionBaseUrl(urlRaw) : '';
    return { baseUrl, apiKey: apiKey.trim() };
  }
}
