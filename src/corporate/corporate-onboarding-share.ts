import type { ConfigService } from '@nestjs/config';

export type CorporateOnboardingShare = {
  enrollmentCode: string;
  webOnboardingUrl: string | null;
  appDownloadUrl: string | null;
  shareText: string;
};

function normalizedBase(raw: string | undefined): string | null {
  const value = raw?.trim().replace(/\/$/, '') ?? '';
  if (!value || !/^https?:\/\//i.test(value)) return null;
  return value;
}

export function buildCorporateOnboardingShare(
  config: ConfigService,
  enrollmentCode: string,
  companyName?: string,
): CorporateOnboardingShare {
  const code = enrollmentCode.trim();
  const corporateBase = normalizedBase(config.get<string>('CORPORATE_APP_URL'));
  const appDownloadUrl = normalizedBase(config.get<string>('CONNECT_APP_URL'));

  const webOnboardingUrl = corporateBase
    ? `${corporateBase}/ativar?${new URLSearchParams({ code }).toString()}`
    : null;

  const company = companyName?.trim() || 'Sua empresa';
  const lines = [
    `${company} convidou você para o benefício Movly.`,
    '',
    `Código de adesão: ${code}`,
    '',
    'No aplicativo: Minha conta → informar código → escolher o plano.',
  ];
  if (webOnboardingUrl) {
    lines.push('', `Instruções no link: ${webOnboardingUrl}`);
  }
  if (appDownloadUrl) {
    lines.push('', `Baixar o app: ${appDownloadUrl}`);
  }

  return {
    enrollmentCode: code,
    webOnboardingUrl,
    appDownloadUrl,
    shareText: lines.join('\n'),
  };
}
