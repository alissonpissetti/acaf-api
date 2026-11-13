import { UserRole, userHasRole } from '../users/user.entity';
import { PARTNER_INVITE_KIND_ONBOARDING, PARTNER_INVITE_KIND_TEAM } from './partner-invite-kind';

/**
 * Espelha a política de `evaluateExistingUserReuseForInvite` para testes unitários
 * sem subir Nest/DB.
 */
function evaluateReusePolicy(input: {
  active: boolean;
  roles: UserRole[];
  linkedUnitIds: string[];
  inviteUnitIds: string[];
  isInviteRecipient: boolean;
  inviteKind: typeof PARTNER_INVITE_KIND_ONBOARDING | typeof PARTNER_INVITE_KIND_TEAM;
}): { allowed: boolean; requireExistingPassword: boolean } {
  if (!input.active) return { allowed: false, requireExistingPassword: false };
  if (userHasRole({ roles: input.roles }, UserRole.ADMIN)) {
    return { allowed: false, requireExistingPassword: false };
  }

  const linkedToThisNetwork = input.linkedUnitIds.some((id) => input.inviteUnitIds.includes(id));
  const linkedToOtherNetwork = input.linkedUnitIds.some((id) => !input.inviteUnitIds.includes(id));

  if (input.inviteKind !== PARTNER_INVITE_KIND_ONBOARDING) {
    if (linkedToThisNetwork || input.isInviteRecipient) {
      return { allowed: true, requireExistingPassword: false };
    }
    return { allowed: false, requireExistingPassword: false };
  }

  if (linkedToThisNetwork || input.isInviteRecipient) {
    return { allowed: true, requireExistingPassword: false };
  }

  if (input.linkedUnitIds.length > 0) {
    if (!userHasRole({ roles: input.roles }, UserRole.PARTNER)) {
      return { allowed: false, requireExistingPassword: false };
    }
    return { allowed: true, requireExistingPassword: false };
  }

  if (userHasRole({ roles: input.roles }, UserRole.PARTNER)) {
    return { allowed: true, requireExistingPassword: false };
  }

  return { allowed: false, requireExistingPassword: false };
}

describe('partner onboarding existing user reuse policy', () => {
  const inviteUnits = ['unit-a', 'unit-b'];

  it('bloqueia admin do console', () => {
    expect(
      evaluateReusePolicy({
        active: true,
        roles: [UserRole.ADMIN],
        linkedUnitIds: [],
        inviteUnitIds: inviteUnits,
        isInviteRecipient: true,
        inviteKind: PARTNER_INVITE_KIND_ONBOARDING,
      }),
    ).toEqual({ allowed: false, requireExistingPassword: false });
  });

  it('permite parceiro de outra rede reutilizando conta sem exigir senha atual', () => {
    expect(
      evaluateReusePolicy({
        active: true,
        roles: [UserRole.PARTNER],
        linkedUnitIds: ['other-unit'],
        inviteUnitIds: inviteUnits,
        isInviteRecipient: false,
        inviteKind: PARTNER_INVITE_KIND_ONBOARDING,
      }),
    ).toEqual({ allowed: true, requireExistingPassword: false });
  });

  it('permite responsável do convite sem exigir senha atual', () => {
    expect(
      evaluateReusePolicy({
        active: true,
        roles: [UserRole.MEMBER],
        linkedUnitIds: [],
        inviteUnitIds: inviteUnits,
        isInviteRecipient: true,
        inviteKind: PARTNER_INVITE_KIND_ONBOARDING,
      }),
    ).toEqual({ allowed: true, requireExistingPassword: false });
  });

  it('bloqueia conta só de cliente sem vínculo nem convite', () => {
    expect(
      evaluateReusePolicy({
        active: true,
        roles: [UserRole.MEMBER],
        linkedUnitIds: [],
        inviteUnitIds: inviteUnits,
        isInviteRecipient: false,
        inviteKind: PARTNER_INVITE_KIND_ONBOARDING,
      }),
    ).toEqual({ allowed: false, requireExistingPassword: false });
  });

  it('mantém política restrita em convite de equipe', () => {
    expect(
      evaluateReusePolicy({
        active: true,
        roles: [UserRole.PARTNER],
        linkedUnitIds: ['other-unit'],
        inviteUnitIds: inviteUnits,
        isInviteRecipient: false,
        inviteKind: PARTNER_INVITE_KIND_TEAM,
      }),
    ).toEqual({ allowed: false, requireExistingPassword: false });
  });
});
