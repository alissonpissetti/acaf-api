import {
  buildPartnerOnboardingWelcomeHtml,
  buildPartnerOnboardingWelcomeSubject,
} from './partner-onboarding-welcome.template';

describe('partner onboarding welcome email', () => {
  const sample = {
    networkName: 'Academia Norte',
    inviteUrl: 'https://parceiro.sejamovly.com/login/onboarding/abc-token',
    expiresAtLabel: '25/11/26, 12:00',
    logoUrl: null,
  };

  it('monta assunto com nome da rede', () => {
    expect(buildPartnerOnboardingWelcomeSubject('Academia Norte')).toContain('Academia Norte');
    expect(buildPartnerOnboardingWelcomeSubject('Academia Norte')).toMatch(/Movly/);
  });

  it('injeta link, validade, logo e fontes no HTML', () => {
    const html = buildPartnerOnboardingWelcomeHtml(sample, {
      logoUrl: 'https://cdn.example.test/branding/movly-logo-lime-on-purple.png',
      fontFaceCss: "@font-face{font-family:'Figtree';font-weight:400;src:url('https://cdn.example.test/f.woff2')}",
    });
    expect(html).toContain('Academia Norte');
    expect(html).toContain(sample.inviteUrl);
    expect(html).toContain(sample.expiresAtLabel);
    expect(html).toContain('https://cdn.example.test/branding/movly-logo-lime-on-purple.png');
    expect(html).toContain("@font-face{font-family:'Figtree'");
    expect(html).not.toContain('__INVITE_URL__');
    expect(html).not.toContain('__NETWORK_NAME__');
    expect(html).not.toContain('__LOGO_URL__');
    expect(html).not.toContain('fonts.googleapis.com');
  });
});