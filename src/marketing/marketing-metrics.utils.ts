import type { MarketingUtmParams } from './marketing-url.utils';

export type MarketingMetricsRange = {
  from?: Date | null;
  to?: Date | null;
};

export function parseMetricsRange(input?: {
  from?: string;
  to?: string;
  period?: string;
}): MarketingMetricsRange {
  if (!input?.from && !input?.to && (!input?.period || input.period === 'all')) {
    return { from: null, to: null };
  }

  if (input.from || input.to) {
    return {
      from: input.from ? startOfDay(input.from) : null,
      to: input.to ? endOfDay(input.to) : null,
    };
  }

  const days = input.period === '7d' ? 7 : input.period === '90d' ? 90 : 30;
  const to = endOfDay(new Date());
  const from = startOfDay(new Date());
  from.setDate(from.getDate() - (days - 1));
  return { from, to };
}

export function detectDeviceType(userAgent?: string | null): 'mobile' | 'desktop' | 'tablet' {
  if (!userAgent) return 'desktop';
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android.*mobile|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
}

export function formatSourceLabel(utmSource?: string | null, utmMedium?: string | null) {
  if (utmSource && utmMedium) return `${utmSource} / ${utmMedium}`;
  if (utmSource) return utmSource;
  if (utmMedium) return utmMedium;
  return 'Direto / orgânico';
}

export function normalizeUtm(input?: MarketingUtmParams) {
  return {
    utmSource: input?.utmSource?.trim() || null,
    utmMedium: input?.utmMedium?.trim() || null,
    utmCampaign: input?.utmCampaign?.trim() || null,
    utmContent: input?.utmContent?.trim() || null,
    utmTerm: input?.utmTerm?.trim() || null,
    creativeId: input?.creativeId?.trim() || null,
  };
}

function startOfDay(value: string | Date) {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value: string | Date) {
  const date = value instanceof Date ? new Date(value) : new Date(`${value}T23:59:59`);
  date.setHours(23, 59, 59, 999);
  return date;
}
