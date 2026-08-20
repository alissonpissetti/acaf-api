export const AVATAR_COLOR_IDS = [
  'slate',
  'blue',
  'indigo',
  'violet',
  'purple',
  'pink',
  'rose',
  'orange',
  'amber',
  'green',
  'teal',
  'cyan',
] as const;

export type AvatarColorId = (typeof AVATAR_COLOR_IDS)[number];

export function isAvatarColorId(value: string | null | undefined): value is AvatarColorId {
  return Boolean(value && AVATAR_COLOR_IDS.includes(value as AvatarColorId));
}

export function pickAvatarColor(seed?: string): AvatarColorId {
  if (!seed) {
    return AVATAR_COLOR_IDS[Math.floor(Math.random() * AVATAR_COLOR_IDS.length)];
  }

  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash + seed.charCodeAt(index) * (index + 1)) % 10_000;
  }

  return AVATAR_COLOR_IDS[hash % AVATAR_COLOR_IDS.length];
}
