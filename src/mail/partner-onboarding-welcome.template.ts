/**
 * E-mail de boas-vindas + convite de onboarding (layout HTML Movly).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type PartnerOnboardingWelcomeContent = {
  networkName: string;
  inviteUrl: string;
  expiresAtLabel: string;
  logoUrl: string | null;
};

export type PartnerOnboardingWelcomeEmailAssets = {
  logoUrl: string | null;
  fontFaceCss: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let cachedWelcomeShell: string | null = null;

function loadWelcomeShell(): string {
  if (!cachedWelcomeShell) {
    cachedWelcomeShell = readFileSync(
      join(__dirname, 'assets', 'partner-onboarding-welcome.html'),
      'utf-8',
    );
  }
  return cachedWelcomeShell;
}

export function buildPartnerOnboardingWelcomeSubject(networkName: string): string {
  const name = networkName.trim() || 'sua academia';
  return `Bem-vindos à Movly by ACAF — ${name}`;
}

export function buildPartnerOnboardingWelcomeText(input: PartnerOnboardingWelcomeContent): string {
  const network = input.networkName.trim() || 'sua academia';
  return [
    'Olá!',
    '',
    `É um prazer ter ${network} na Movly by ACAF.`,
    '',
    'O produto que apresentamos como projeto provisório evoluiu para o nome oficial Movly (by ACAF).',
    '',
    'Próximos passos: desenvolvimento até dez/26, testes em jan/27, go live a partir de fev/27.',
    '',
    'Configure sua academia pelo link pessoal de onboarding (válido até ' +
      `${input.expiresAtLabel}):`,
    input.inviteUrl.trim(),
    '',
    'Dúvidas: marcelo.ferreira@sejamovly.com · tecnologia@sejamovly.com',
    '',
    '— Equipe Movly by ACAF',
  ].join('\n');
}

function logoImgHtml(logoUrl: string | null | undefined, width: number, height: number): string {
  const url = logoUrl?.trim();
  if (!url) {
    return `<p style="margin:0;font-family:'Unbounded',Arial,sans-serif;font-size:22px;font-weight:600;color:#CBF74F;">movly.</p>`;
  }
  return `<img src="${escapeHtml(url)}" width="${width}" height="${height}" alt="movly. by ACAF" style="display:block;width:${width}px;height:${height}px;border:0;outline:none;" />`;
}

export function buildPartnerOnboardingWelcomeHtml(
  input: PartnerOnboardingWelcomeContent,
  assets?: PartnerOnboardingWelcomeEmailAssets,
): string {
  const network = escapeHtml(input.networkName.trim() || 'sua academia');
  const inviteUrl = escapeHtml(input.inviteUrl.trim());
  const expires = escapeHtml(input.expiresAtLabel);
  const logoUrl = assets?.logoUrl ?? input.logoUrl;
  const fontFaceCss = assets?.fontFaceCss?.trim() ?? '';
  const fontStyleTag = fontFaceCss ? `<style>${fontFaceCss}</style>` : '';

  let html = loadWelcomeShell()
    .replaceAll('__NETWORK_NAME__', network)
    .replaceAll('__INVITE_URL__', inviteUrl)
    .replaceAll('__EXPIRES_AT__', expires)
    .replace('__FONT_FACE_STYLE__', fontStyleTag);

  const heroLogo = logoImgHtml(logoUrl, 180, 79);
  const footerLogo = logoImgHtml(logoUrl, 120, 53);
  html = html.replace(/<img[^>]*__LOGO_URL__[^>]*>/, heroLogo);
  html = html.replace(/<img[^>]*__LOGO_URL__[^>]*>/, footerLogo);

  return html;
}