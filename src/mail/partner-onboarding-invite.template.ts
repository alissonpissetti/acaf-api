/**
 * Convite de onboarding — portal parceiro (rede de academias).
 */

import {
  buildPartnerOnboardingWelcomeHtml,
  buildPartnerOnboardingWelcomeSubject,
  buildPartnerOnboardingWelcomeText,
} from './partner-onboarding-welcome.template';

export type { PartnerOnboardingWelcomeContent as PartnerOnboardingInviteContent } from './partner-onboarding-welcome.template';
import type {
  PartnerOnboardingWelcomeContent,
  PartnerOnboardingWelcomeEmailAssets,
} from './partner-onboarding-welcome.template';

export function buildPartnerOnboardingInviteSubject(networkName: string): string {
  return buildPartnerOnboardingWelcomeSubject(networkName);
}

export function buildPartnerOnboardingInviteText(input: PartnerOnboardingWelcomeContent): string {
  return buildPartnerOnboardingWelcomeText(input);
}

export function buildPartnerOnboardingInviteHtml(
  input: PartnerOnboardingWelcomeContent,
  assets?: PartnerOnboardingWelcomeEmailAssets,
): string {
  return buildPartnerOnboardingWelcomeHtml(input, assets);
}
