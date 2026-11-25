import { maskEmailForDisplay, maskMobilePhoneForDisplay } from './partner-onboarding-contact-mask';

describe('partner contact masks', () => {
  it('mascara e-mail parcialmente', () => {
    expect(maskEmailForDisplay('maria@academia.com.br')).toBe('ma***@ac***.com.br');
  });

  it('mascara celular parcialmente', () => {
    expect(maskMobilePhoneForDisplay('11987654321')).toBe('(11) 9****-4321');
  });
});