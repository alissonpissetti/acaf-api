/**
 * Recuperação do onboarding inicial — código por e-mail (CNPJ sem link).
 */

const BRAND = {
  purple: '#8254e4',
  purpleDeep: '#2a1b57',
  ink: '#17142b',
  muted: '#4a4660',
  border: '#ebeaf1',
  surfaceMuted: '#f4f3f8',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type PartnerOnboardingRecoveryCodeContent = {
  networkName: string;
  code: string;
  ttlMinutes: number;
  logoUrl: string | null;
};

export type PartnerOnboardingAlreadyConfiguredContent = {
  networkName: string;
  loginUrl: string;
  logoUrl: string | null;
};

function logoBlock(logoUrl: string | null): string {
  const url = logoUrl?.trim() ?? '';
  if (url) {
    return `<img src="${escapeHtml(url)}" alt="movly." width="160" height="82" style="display:block;height:auto;max-width:160px" />`;
  }
  return `<p style="margin:0;font-size:22px;font-weight:700;color:${BRAND.purpleDeep}">movly.</p>`;
}

function wrapEmail(inner: string, logoUrl: string | null): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:${BRAND.surfaceMuted};font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${BRAND.ink};line-height:1.5">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.surfaceMuted};padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid ${BRAND.border};overflow:hidden">
          <tr>
            <td style="background:linear-gradient(135deg,${BRAND.purpleDeep},${BRAND.purple});padding:28px 24px">
              ${logoBlock(logoUrl)}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px">
              ${inner}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildPartnerOnboardingRecoveryCodeSubject(networkName: string): string {
  const name = networkName.trim() || 'sua academia';
  return `Código de verificação — portal parceiro Movly (${name})`;
}

export function buildPartnerOnboardingRecoveryCodeText(
  input: PartnerOnboardingRecoveryCodeContent,
): string {
  const network = input.networkName.trim() || 'sua rede de academias';
  const minutes = Math.max(1, Math.round(input.ttlMinutes));
  return [
    'Olá!',
    '',
    `Use o código abaixo para continuar a configuração inicial do portal parceiro Movly da rede ${network}.`,
    '',
    `Código: ${input.code}`,
    '',
    `Ele vale por ${minutes} minutos e só pode ser usado uma vez.`,
    '',
    'Se você não pediu este código, ignore o e-mail ou fale com o time Movly.',
    '',
    '— movly. by ACAF',
  ].join('\n');
}

export function buildPartnerOnboardingRecoveryCodeHtml(
  input: PartnerOnboardingRecoveryCodeContent,
): string {
  const network = escapeHtml(input.networkName.trim() || 'sua rede de academias');
  const code = escapeHtml(input.code);
  const minutes = Math.max(1, Math.round(input.ttlMinutes));
  const inner = `
              <h1 style="margin:0 0 12px;font-size:20px;color:${BRAND.ink}">Código de verificação</h1>
              <p style="margin:0 0 16px;color:${BRAND.muted}">Continue o cadastro inicial da rede <strong style="color:${BRAND.ink}">${network}</strong> no portal parceiro Movly.</p>
              <p style="margin:0 0 20px;font-size:28px;letter-spacing:0.24em;font-weight:700;color:${BRAND.purpleDeep};font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${code}</p>
              <p style="margin:0;font-size:13px;color:${BRAND.muted}">Válido por <strong>${minutes} minutos</strong>. Não compartilhe este código.</p>`;
  return wrapEmail(inner, input.logoUrl);
}

export function buildPartnerOnboardingAlreadyConfiguredSubject(networkName: string): string {
  const name = networkName.trim() || 'sua academia';
  return `Acesso já configurado — portal parceiro Movly (${name})`;
}

export function buildPartnerOnboardingAlreadyConfiguredText(
  input: PartnerOnboardingAlreadyConfiguredContent,
): string {
  const network = input.networkName.trim() || 'sua rede de academias';
  return [
    'Olá!',
    '',
    `O acesso ao portal parceiro Movly da rede ${network} já está configurado.`,
    '',
    'Entre com e-mail e senha (ou código no celular):',
    input.loginUrl,
    '',
    'Para incluir outra pessoa da equipe, peça um convite de equipe a quem já administra o portal (ou ao time Movly).',
    '',
    'Se você não pediu esta mensagem, ignore o e-mail.',
    '',
    '— movly. by ACAF',
  ].join('\n');
}

export function buildPartnerOnboardingAlreadyConfiguredHtml(
  input: PartnerOnboardingAlreadyConfiguredContent,
): string {
  const network = escapeHtml(input.networkName.trim() || 'sua rede de academias');
  const loginUrl = escapeHtml(input.loginUrl.trim());
  const inner = `
              <h1 style="margin:0 0 12px;font-size:20px;color:${BRAND.ink}">Acesso já configurado</h1>
              <p style="margin:0 0 16px;color:${BRAND.muted}">A rede <strong style="color:${BRAND.ink}">${network}</strong> já concluiu o cadastro inicial no portal parceiro Movly.</p>
              <p style="margin:0 0 20px;color:${BRAND.muted}">Entre com e-mail e senha, ou peça um convite de equipe a quem já administra o portal.</p>
              <p style="margin:0 0 24px">
                <a href="${loginUrl}" style="display:inline-block;background:${BRAND.purple};color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">Entrar no portal</a>
              </p>
              <p style="margin:0;font-size:12px;color:${BRAND.muted};word-break:break-all">Ou copie: ${loginUrl}</p>`;
  return wrapEmail(inner, input.logoUrl);
}
