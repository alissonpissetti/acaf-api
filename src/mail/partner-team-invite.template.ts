/**
 * Convite de equipe — portal parceiro (rede já configurada).
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

export type PartnerTeamInviteContent = {
  networkName: string;
  inviteUrl: string;
  expiresAtLabel: string;
  logoUrl: string | null;
};

export function buildPartnerTeamInviteSubject(networkName: string): string {
  const name = networkName.trim() || 'sua academia';
  return `Convite equipe — portal parceiro Movly (${name})`;
}

export function buildPartnerTeamInviteText(input: PartnerTeamInviteContent): string {
  const network = input.networkName.trim() || 'sua rede de academias';
  const lines = [
    'Olá!',
    '',
    `Você foi convidado a criar seu acesso ao portal parceiro Movly da rede ${network}.`,
    '',
    'A rede já está configurada no sistema. Após o cadastro, você poderá gerenciar as unidades vinculadas a esta rede.',
    '',
    `Use o link abaixo para criar seu usuário (válido até ${input.expiresAtLabel}):`,
    input.inviteUrl,
    '',
    'Se você não esperava este e-mail, ignore-o ou fale com o time Movly.',
    '',
    '— movly. by ACAF',
  ];
  return lines.join('\n');
}

export function buildPartnerTeamInviteHtml(input: PartnerTeamInviteContent): string {
  const network = escapeHtml(input.networkName.trim() || 'sua rede de academias');
  const inviteUrl = escapeHtml(input.inviteUrl.trim());
  const expires = escapeHtml(input.expiresAtLabel);
  const logoUrl = input.logoUrl?.trim() ?? '';

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="movly." width="160" height="82" style="display:block;height:auto;max-width:160px" />`
    : `<p style="margin:0;font-size:22px;font-weight:700;color:${BRAND.purpleDeep}">movly.</p>`;

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
              ${logoBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px">
              <h1 style="margin:0 0 12px;font-size:20px;color:${BRAND.ink}">Acesso à equipe</h1>
              <p style="margin:0 0 16px;color:${BRAND.muted}">Crie seu login para gerenciar a rede <strong style="color:${BRAND.ink}">${network}</strong> no portal parceiro Movly.</p>
              <p style="margin:0 0 12px;font-size:14px;color:${BRAND.muted}">As unidades da rede já estão configuradas — após o cadastro você terá acesso ao painel.</p>
              <p style="margin:0 0 20px;font-size:14px;color:${BRAND.muted}">O link expira em <strong>${expires}</strong>.</p>
              <p style="margin:0 0 24px">
                <a href="${inviteUrl}" style="display:inline-block;background:${BRAND.purple};color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:999px">Criar meu acesso</a>
              </p>
              <p style="margin:0;font-size:12px;color:${BRAND.muted};word-break:break-all">Ou copie: ${inviteUrl}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
