/** Cache em memória das variáveis de sistema (fonte: banco). */
let entries: Record<string, string> = {};

export function setSystemSettingsCache(map: Record<string, string>) {
  entries = { ...map };
}

export function patchSystemSettingCache(key: string, value: string) {
  entries[key] = value;
}

export function getSystemSetting(key: string): string | undefined {
  return entries[key];
}
