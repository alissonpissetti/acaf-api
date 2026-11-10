import {
  formatMobilePhone,
  isValidMobilePhone,
  normalizeMobilePhone,
} from '../users/person.utils';

export type ResolvedEvolutionContact = {
  remoteJid: string;
  contactKey: string;
  phone: string | null;
  isGroup: boolean;
};

export function isWhatsAppLidJid(jid: string): boolean {
  return /@lid$/i.test(jid) || jid.toLowerCase().includes('@lid');
}

export function isWhatsAppPhoneJid(jid: string): boolean {
  const lower = jid.toLowerCase();
  return lower.includes('@s.whatsapp.net') || lower.includes('@c.us');
}

function digitsFromJid(jid: string): string {
  return jid.split('@')[0]?.replace(/\D/g, '') ?? '';
}

function phoneFromPhoneJid(jid: string): string | null {
  if (!jid || isWhatsAppLidJid(jid)) return null;
  const digits = digitsFromJid(jid);
  if (!digits) return null;
  if (digits.length >= 12 && digits.startsWith('55')) {
    const local = digits.slice(-11);
    return isValidMobilePhone(local) ? local : null;
  }
  const local = normalizeMobilePhone(digits);
  return isValidMobilePhone(local) ? local : null;
}

/** Número sem JID (ex.: `41988908506` ou `5541988908506` no campo senderPn). */
export function phoneFromBareDigits(value: string): string | null {
  const digits = normalizeMobilePhone(value);
  if (isValidMobilePhone(digits)) return digits;
  if (digits.length >= 12 && digits.startsWith('55')) {
    const local = digits.slice(-11);
    if (isValidMobilePhone(local)) return local;
  }
  if (digits.length === 10) {
    const candidate = `${digits.slice(0, 2)}9${digits.slice(2)}`;
    if (isValidMobilePhone(candidate)) return candidate;
  }
  return null;
}

export function phoneFromSenderPn(senderPn: string): string | null {
  const raw = String(senderPn ?? '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return phoneFromPhoneJid(raw);
  return phoneFromBareDigits(raw);
}

function buildContactKey(phone: string | null, lidJid: string | null, fallbackJid: string): string {
  if (phone) return phone;
  if (lidJid) {
    const lid = digitsFromJid(lidJid);
    if (lid) return `lid:${lid}`;
  }
  if (isWhatsAppPhoneJid(fallbackJid)) {
    const fromFallback = phoneFromPhoneJid(fallbackJid);
    if (fromFallback) return fromFallback;
  }
  if (isWhatsAppLidJid(fallbackJid)) {
    const raw = digitsFromJid(fallbackJid);
    if (raw) return `lid:${raw}`;
  }
  return 'unknown';
}

export function resolveEvolutionContact(key: Record<string, unknown>): ResolvedEvolutionContact | null {
  const remote = String(key.remoteJid ?? '').trim();
  const alt = String(key.remoteJidAlt ?? '').trim();
  const participant = String(key.participant ?? '').trim();
  const participantAlt = String(key.participantAlt ?? '').trim();
  const senderPn = String(key.senderPn ?? '').trim();
  const jids = [remote, alt, participant, participantAlt, senderPn].filter(Boolean);

  const isGroup = jids.some(
    (jid) => jid.includes('@g.us') || jid.includes('@broadcast'),
  );
  if (isGroup) {
    const groupJid =
      jids.find((jid) => jid.includes('@g.us')) ??
      jids.find((jid) => jid.includes('@broadcast')) ??
      remote ??
      jids[0] ??
      '';
    const digits = groupJid.split('@')[0]?.replace(/\D/g, '') ?? '';
    const contactKey = digits ? `group:${digits}` : 'unknown';
    return {
      remoteJid: groupJid,
      contactKey: contactKey === 'unknown' ? 'unknown' : contactKey,
      phone: null,
      isGroup: true,
    };
  }

  const phoneJid = jids.find((jid) => isWhatsAppPhoneJid(jid)) ?? null;
  const lidJid = jids.find((jid) => isWhatsAppLidJid(jid)) ?? null;
  let phone = phoneJid ? phoneFromPhoneJid(phoneJid) : null;
  if (!phone && senderPn) {
    phone = phoneFromSenderPn(senderPn);
  }
  if (!phone) {
    for (const jid of jids) {
      if (!jid || jid.includes('@')) continue;
      phone = phoneFromBareDigits(jid);
      if (phone) break;
    }
  }
  const primaryJid = phoneJid ?? lidJid ?? remote ?? alt;
  if (!primaryJid) return null;

  const contactKey = buildContactKey(phone, lidJid, primaryJid);
  if (contactKey === 'unknown') return null;

  return {
    remoteJid: primaryJid,
    contactKey,
    phone,
    isGroup: false,
  };
}

export function isHumanContactName(value: string | null | undefined): boolean {
  const name = String(value ?? '').trim();
  if (!name) return false;
  if (/^você$/i.test(name)) return false;

  const stripped = name.replace(/^whatsapp\s+/i, '').trim();
  const digitsOnly = stripped.replace(/\D/g, '');
  const alpha = stripped.replace(/[\d\s().\-+]/g, '').length;

  if (digitsOnly.length >= 8 && alpha === 0) return false;
  if (/^whatsapp\s+[\d()\s.\-]+$/i.test(name)) return false;
  if (/^whatsapp\s*···\d*$/i.test(name)) return false;
  if (/^···\d+$/i.test(name)) return false;
  return true;
}

export function formatPhoneLenient(contactKey: string): string | null {
  const key = String(contactKey ?? '').trim();
  if (key.startsWith('lid:')) return null;
  const digits = normalizeMobilePhone(key);
  if (!isValidMobilePhone(digits)) return null;
  return formatMobilePhone(digits);
}

export function normalizedBrazilMobileKey(contactKey: string): string | null {
  const digits = normalizeMobilePhone(contactKey);
  return isValidMobilePhone(digits) ? digits : null;
}

export function lidReferenceLabel(contactKey: string): string | null {
  const key = String(contactKey ?? '').trim();
  if (!key.startsWith('lid:')) return null;
  const digits = key.slice(4).replace(/\D/g, '');
  if (!digits) return 'WhatsApp (privado)';
  const tail = digits.length > 6 ? digits.slice(-6) : digits;
  return `WhatsApp ···${tail}`;
}

export function isGroupContactKey(contactKey: string): boolean {
  return String(contactKey ?? '').trim().startsWith('group:');
}

export function groupLabelFromKey(contactKey: string, preferredName?: string | null): string {
  if (isPlausibleGroupTitle(preferredName)) return String(preferredName).trim();
  const digits = contactKey.replace(/^group:/, '');
  if (digits) return `Grupo WhatsApp ···${digits.slice(-6)}`;
  return 'Grupo WhatsApp';
}

export function isGenericGroupLabel(name: string | null | undefined, contactKey?: string): boolean {
  const value = String(name ?? '').trim();
  if (!value) return true;
  if (/^Grupo WhatsApp ···\d+$/i.test(value)) return true;
  if (contactKey?.startsWith('group:')) {
    const tail = contactKey.replace(/^group:/, '').slice(-6);
    if (tail && value.includes(tail) && /^grupo/i.test(value)) return true;
  }
  return isGenericInboxLabel(value);
}

export function stripEmojiForNameHeuristic(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\uFE0F/g, '')
    .replace(/[®©™]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sinais de que o texto parece nome de grupo/comunidade, não de uma pessoa. */
export function hasGroupTitleSignals(value: string): boolean {
  const text = String(value ?? '').trim();
  if (!text) return false;
  if (text.length >= 18) return true;
  if (text.split(/\s+/).length >= 4) return true;
  if (/\d{2,}/.test(text)) return true;
  if (/[-–—|/]/.test(text)) return true;
  if (
    /grupo|group|sorteio|sorteios|promo|turma|família|familia|condomínio|condominio|comunidade|equipe|clube|time\b|opala|fraldas/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}

export function isLikelyParticipantName(name: string | null | undefined): boolean {
  const value = stripEmojiForNameHeuristic(String(name ?? ''));
  if (!value || value.length > 100) return false;
  if (
    /grupo|group|família|familia|turma|equipe|staff|condomínio|condominio|comunidade|amigos|rede|clube|time\b/i.test(
      value,
    )
  ) {
    return false;
  }
  if (/[\\/|@#]/.test(value) && value.length >= 6) return false;
  if (value.split(/\s+/).length >= 4) return false;
  if (/^[A-ZÀ-Ü0-9][\wÀ-ü.\-'\s]{1,80}$/iu.test(value) && !/\d{5,}/.test(value)) {
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length === 1 && /^[A-ZÀ-Ü0-9]{2,}$/.test(words[0]!) && !/[a-zà-ü]/.test(words[0]!)) {
      return false;
    }
    const cleanWords = words.map((w) => w.replace(/[®©™.]/g, ''));
    if (
      words.length <= 3 &&
      cleanWords.every(
        (w) => /^[A-ZÀ-Ü][\wÀ-ü'-]{0,40}$/u.test(w) || /^[a-zà-ü][\wà-ü'-]{0,40}$/u.test(w),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Nome de grupo vindo direto da Evolution (`subject` em fetchAllGroups) — fonte confiável. */
export function evolutionGroupSubjectTitle(
  subject: string | null | undefined,
  options?: { trustRemote?: boolean },
): string | null {
  const raw = String(subject ?? '').trim();
  if (!raw || raw.length > 150) return null;
  if (isGenericGroupLabel(raw)) return null;
  const normalized = stripEmojiForNameHeuristic(raw);
  if (isLikelyParticipantName(normalized)) return null;
  if (!options?.trustRemote && !hasGroupTitleSignals(normalized)) {
    return null;
  }
  const digits = raw.replace(/\D/g, '');
  const alpha = raw.replace(/[\d\s().\-+™®©]/g, '').length;
  if (digits.length >= 10 && alpha === 0) return null;
  return raw;
}

export function isPlausibleGroupTitle(name: string | null | undefined): boolean {
  const value = stripEmojiForNameHeuristic(String(name ?? ''));
  if (value.length < 2) return false;
  if (isGenericGroupLabel(value)) return false;
  if (isLikelyParticipantName(value)) return false;
  const digits = value.replace(/\D/g, '');
  const alpha = value.replace(/[\d\s().\-+™]/g, '').length;
  if (digits.length >= 10 && alpha === 0) return false;
  return true;
}

export function extractGroupSubjectFromRecord(item: Record<string, unknown>): string | undefined {
  const candidates = [
    item.subject,
    item.name,
    item.groupName,
    item.conversationName,
    item.verifiedName,
    (item.groupMetadata as Record<string, unknown> | undefined)?.subject,
    (item.chat as Record<string, unknown> | undefined)?.name,
    (item.chat as Record<string, unknown> | undefined)?.subject,
    (item.lastMessage as Record<string, unknown> | undefined)?.subject,
    (item.lastMessage as Record<string, unknown> | undefined)?.name,
  ];
  for (const raw of candidates) {
    const name = String(raw ?? '').trim();
    if (isPlausibleGroupTitle(name)) return name;
  }
  return undefined;
}

export function pickBestGroupThreadName(
  candidates: Array<string | null | undefined>,
  contactKey: string,
): string {
  for (const raw of candidates) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) continue;
    const normalized = stripEmojiForNameHeuristic(trimmed);
    if (isLikelyParticipantName(normalized)) continue;
    const auth = evolutionGroupSubjectTitle(trimmed);
    if (auth) return auth;
    if (isPlausibleGroupTitle(trimmed)) return trimmed;
  }
  return groupLabelFromKey(contactKey);
}

export function isGenericGroupThreadName(name: string | null | undefined, contactKey?: string): boolean {
  return isGenericGroupLabel(name, contactKey) || /^Grupo WhatsApp ···\d+$/i.test(String(name ?? '').trim());
}

export function contactLabelFromKey(contactKey: string, preferredName?: string | null): string {
  if (isHumanContactName(preferredName)) return String(preferredName).trim();
  if (isGroupContactKey(contactKey)) return groupLabelFromKey(contactKey, preferredName);
  const phone = formatPhoneLenient(contactKey);
  if (phone) return phone;
  return lidReferenceLabel(contactKey) ?? 'Contato WhatsApp';
}

export function phoneKeyFromJid(jid: string): string | null {
  const phone = phoneFromPhoneJid(jid);
  return phone ?? null;
}

export function isGenericInboxLabel(name: string | null | undefined): boolean {
  const value = String(name ?? '').trim();
  if (!value) return true;
  if (value === 'Contato WhatsApp') return true;
  if (/^contato\s*·/i.test(value)) return true;
  if (/^whatsapp\s*···\d+$/i.test(value)) return true;
  if (/^grupo whatsapp\s*···/i.test(value)) return true;
  return false;
}

export function extractPushName(item: Record<string, unknown>, fromMe: boolean): string | undefined {
  if (fromMe) return undefined;
  const direct = [
    item.pushName,
    item.verifiedBizName,
    item.notifyName,
    item.name,
    (item.contact as Record<string, unknown> | undefined)?.name,
    (item.contact as Record<string, unknown> | undefined)?.pushName,
    (item.contact as Record<string, unknown> | undefined)?.verifiedName,
  ];
  for (const raw of direct) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    if (!isHumanContactName(name)) continue;
    return name;
  }
  return undefined;
}

export function formatInboxContactDisplay(input: {
  contactName: string | null;
  leadTitle: string | null;
  leadContactName: string | null;
  contactKey: string;
}): string {
  const candidates = [input.contactName, input.leadContactName, input.leadTitle];
  for (const raw of candidates) {
    if (isHumanContactName(raw)) return String(raw).trim();
  }
  return contactLabelFromKey(input.contactKey);
}

export function pickBestThreadContactName(
  messageNames: Array<string | null | undefined>,
  lead: { title: string | null; contactName: string | null; phone?: string | null } | null,
  contactKey: string,
  phoneLabel?: string | null,
): string {
  if (isGroupContactKey(contactKey)) {
    return pickBestGroupThreadName(messageNames, contactKey);
  }
  for (const raw of messageNames) {
    const value = String(raw ?? '').trim();
    if (!isHumanContactName(value)) continue;
    if (isGenericInboxLabel(value)) continue;
    return value;
  }
  if (lead) {
    if (isHumanContactName(lead.contactName)) return String(lead.contactName).trim();
    if (isHumanContactName(lead.title)) return String(lead.title).trim();
    const leadPhone = lead.phone ? formatMobilePhone(normalizeMobilePhone(lead.phone)) : null;
    if (leadPhone) return leadPhone;
  }
  const phoneFromProfile = phoneLabel?.trim();
  if (phoneFromProfile) {
    const formatted = formatPhoneLenient(normalizeMobilePhone(phoneFromProfile)) ?? phoneFromProfile;
    if (!isGenericInboxLabel(formatted)) return formatted;
  }
  const fromKey = formatPhoneLenient(contactKey);
  if (fromKey) return fromKey;
  return contactLabelFromKey(contactKey);
}

export function formatInboxContactSubtitle(contactKey: string, displayName: string): string | null {
  const phone = formatPhoneLenient(contactKey);
  if (!phone) return null;
  if (phone === displayName) return null;
  return phone;
}

export type InboxContactKind = 'named' | 'phone' | 'private' | 'unknown';

export type InboxContactPresentation = {
  kind: InboxContactKind;
  title: string;
  nameLine: string | null;
  phoneLine: string | null;
  subtitle: string | null;
  badge: string | null;
  isPrivateContact: boolean;
};

export function resolveInboxContactPresentation(input: {
  contactKey: string;
  displayName: string;
  phoneLabel: string | null;
  instanceName: string;
  leadTitle?: string | null;
  leadContactName?: string | null;
  leadPhone?: string | null;
}): InboxContactPresentation {
  const contactKey = String(input.contactKey ?? '').trim();
  if (isGroupContactKey(contactKey)) {
    const title = pickBestGroupThreadName([input.displayName], contactKey);
    const instance = String(input.instanceName ?? '').trim();
    return {
      kind: 'named',
      title,
      nameLine: null,
      phoneLine: null,
      subtitle: instance ? `Grupo · ${instance}` : 'Grupo',
      badge: 'Grupo',
      isPrivateContact: false,
    };
  }
  const phoneFromKey = formatPhoneLenient(contactKey);
  const phoneFromLabel = (() => {
    const raw = input.phoneLabel?.trim();
    if (!raw) return null;
    const fromDigits = formatPhoneLenient(normalizeMobilePhone(raw));
    if (fromDigits) return fromDigits;
    return formatPhoneLenient(raw) ?? null;
  })();
  const phoneFromLead =
    !contactKey.startsWith('lid:') &&
    input.leadPhone &&
    isValidMobilePhone(normalizeMobilePhone(input.leadPhone))
      ? formatMobilePhone(normalizeMobilePhone(input.leadPhone))
      : null;
  const phone = phoneFromKey || phoneFromLabel || phoneFromLead;
  const isPrivate = contactKey.startsWith('lid:');

  const nameCandidates = [
    input.displayName,
    input.leadContactName,
    input.leadTitle,
  ];
  let nameLine: string | null = null;
  for (const raw of nameCandidates) {
    const value = String(raw ?? '').trim();
    if (!isHumanContactName(value)) continue;
    if (phone && value === phone) continue;
    if (isGenericInboxLabel(value)) continue;
    nameLine = value;
    break;
  }

  if (nameLine) {
    const subtitleParts: string[] = [];
    if (phone && phone !== nameLine) subtitleParts.push(phone);
    if (input.instanceName) subtitleParts.push(input.instanceName);
    return {
      kind: 'named',
      title: nameLine,
      nameLine,
      phoneLine: phone && phone !== nameLine ? phone : null,
      subtitle: subtitleParts.join(' · ') || input.instanceName || null,
      badge: isPrivate && !phone ? 'Privacidade WhatsApp' : null,
      isPrivateContact: isPrivate && !phone,
    };
  }

  if (phone) {
    return {
      kind: 'phone',
      title: phone,
      nameLine: null,
      phoneLine: phone,
      subtitle: input.instanceName || null,
      badge: null,
      isPrivateContact: false,
    };
  }

  if (isPrivate) {
    const ref = lidReferenceLabel(contactKey) ?? 'Contato privado';
    return {
      kind: 'private',
      title: ref,
      nameLine: null,
      phoneLine: null,
      subtitle: [input.instanceName, 'Número não disponível'].filter(Boolean).join(' · '),
      badge: 'Número oculto',
      isPrivateContact: true,
    };
  }

  return {
    kind: 'unknown',
    title: 'Contato WhatsApp',
    nameLine: null,
    phoneLine: null,
    subtitle: input.instanceName || null,
    badge: null,
    isPrivateContact: false,
  };
}

export const WHATSAPP_INBOX_CONTACT_MARKER_PREFIX = 'whatsapp-contact:';

export function whatsappInboxContactMarker(contactKey: string): string {
  return `${WHATSAPP_INBOX_CONTACT_MARKER_PREFIX}${contactKey}`;
}
