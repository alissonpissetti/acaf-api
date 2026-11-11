/**
 * Convite corporativo — layout alinhado ao manual Movly (movly-by-acaf.app.pdf)
 * e tokens do portal corporate (--movly-purple, --movly-lime, gradiente céu → periwinkle).
 */

const BRAND = {
  purple: '#8254e4',
  purpleDeep: '#2a1b57',
  lime: '#cbf74f',
  sky: '#89b4e0',
  periwinkle: '#7579e5',
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

export type EmployeeEnrollmentInviteContent = {
  employeeName: string;
  companyName: string;
  enrollmentCode: string;
  appUrl: string | null;
  logoUrl: string | null;
};

export function buildEmployeeEnrollmentInviteSubject(companyName: string): string {
  const company = companyName.trim() || 'sua empresa';
  return `Convite Movly — ${company}`;
}

export function buildEmployeeEnrollmentInviteText(
  input: EmployeeEnrollmentInviteContent,
): string {
  const greetName = input.employeeName.trim();
  const company = input.companyName.trim() || 'sua empresa';
  const code = input.enrollmentCode.trim();

  const lines = [
    greetName ? `Olá, ${greetName}!` : 'Olá!',
    '',
    `${company} convidou você para o benefício de bem-estar no app Movly.`,
    '',
    'Seu código de adesão da empresa:',
    code,
    '',
    'Como ativar:',
    '1. Baixe o aplicativo Movly',
    input.appUrl ? `   ${input.appUrl}` : '   (peça o link à sua empresa, se ainda não tiver)',
    '2. Abra Minha conta',
    '3. Informe o código acima e escolha seu plano',
    '',
    'Use este código apenas se você for colaborador autorizado.',
    '',
    '— movly. by ACAF',
  ];

  return lines.join('\n');
}

export function buildEmployeeEnrollmentInviteHtml(
  input: EmployeeEnrollmentInviteContent,
): string {
  const greetName = escapeHtml(input.employeeName.trim());
  const company = escapeHtml(input.companyName.trim() || 'sua empresa');
  const code = escapeHtml(input.enrollmentCode.trim());
  const appUrl = input.appUrl?.trim() ?? '';
  const logoUrl = input.logoUrl?.trim() ?? '';

  const greeting = greetName
    ? `Olá, <strong style="color:${BRAND.ink}">${greetName}</strong>!`
    : 'Olá!';

  const ctaBlock = appUrl
    ? `<tr>
        <td align="center" style="padding:0 32px 28px">
          <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:${BRAND.lime};color:${BRAND.purpleDeep};font-weight:700;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:999px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">Baixar o aplicativo</a>
        </td>
      </tr>`
    : '';

  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="180" height="88" alt="movly. by ACAF" style="display:block;border:0;width:180px;height:auto;max-width:180px" />`
    : `<div style="font-size:28px;font-weight:800;letter-spacing:-0.04em;color:${BRAND.lime};font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">movly<span style="color:${BRAND.lime}">.</span></div>
       <div style="margin-top:6px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.75);font-family:system-ui,sans-serif">by ACAF</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>Convite Movly</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.surfaceMuted};font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.surfaceMuted};padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${BRAND.border};box-shadow:0 12px 40px rgba(42,27,87,0.08)">
          <tr>
            <td style="padding:0;background:linear-gradient(135deg, ${BRAND.sky} 0%, ${BRAND.periwinkle} 55%, ${BRAND.purple} 100%);height:6px;font-size:0;line-height:0">&nbsp;</td>
          </tr>
          <tr>
            <td align="center" style="padding:28px 32px 20px;background:${BRAND.purpleDeep}">
              ${logoBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px">
              <p style="margin:0 0 12px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:${BRAND.purple}">Convite corporativo</p>
              <p style="margin:0 0 16px;font-size:17px;line-height:1.55;color:${BRAND.muted}">${greeting}</p>
              <p style="margin:0;font-size:16px;line-height:1.6;color:${BRAND.ink}"><strong>${company}</strong> convidou você para acessar o benefício de bem-estar no <strong>app Movly</strong>.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 20px">
              <p style="margin:0 0 10px;font-size:14px;color:${BRAND.muted}">Seu código de adesão da empresa:</p>
              <div style="text-align:center;padding:20px 16px;border-radius:14px;background:${BRAND.surfaceMuted};border:1px dashed rgba(130,84,228,0.35)">
                <span style="display:inline-block;font-size:26px;font-weight:800;letter-spacing:0.18em;color:${BRAND.purpleDeep};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${code}</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 24px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:rgba(130,84,228,0.06);border-radius:12px;border:1px solid rgba(130,84,228,0.12)">
                <tr>
                  <td style="padding:18px 20px">
                    <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:${BRAND.ink}">Como entrar no app</p>
                    <ol style="margin:0;padding-left:20px;color:${BRAND.muted};font-size:14px;line-height:1.65">
                      <li style="margin-bottom:6px">${appUrl ? 'Baixe o aplicativo Movly pelo botão abaixo.' : 'Baixe o aplicativo Movly na loja do seu celular.'}</li>
                      <li style="margin-bottom:6px">Abra <strong style="color:${BRAND.ink}">Minha conta</strong>.</li>
                      <li>Informe o código acima e escolha seu plano.</li>
                    </ol>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ${ctaBlock}
          <tr>
            <td style="padding:0 32px 28px">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#858199">Este convite é pessoal. Use o código apenas se você for colaborador autorizado da empresa.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:${BRAND.surfaceMuted};border-top:1px solid ${BRAND.border};text-align:center">
              <p style="margin:0;font-size:12px;color:#858199">movly. by ACAF — energia de quem treina, calma do bem-estar.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
