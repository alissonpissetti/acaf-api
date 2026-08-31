export type MarketingUtmParams = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  creativeId?: string | null;
};

export function buildMarketingFormPath(slug: string, params: MarketingUtmParams = {}): string {
  const search = new URLSearchParams();
  if (params.utmSource) search.set('utm_source', params.utmSource);
  if (params.utmMedium) search.set('utm_medium', params.utmMedium);
  if (params.utmCampaign) search.set('utm_campaign', params.utmCampaign);
  if (params.utmContent) search.set('utm_content', params.utmContent);
  if (params.utmTerm) search.set('utm_term', params.utmTerm);
  if (params.creativeId) search.set('cr', params.creativeId);

  const query = search.toString();
  return query ? `/f/${slug}?${query}` : `/f/${slug}`;
}

export function buildMarketingFormUrl(
  slug: string,
  params: MarketingUtmParams,
  baseUrl?: string | null,
): string {
  const path = buildMarketingFormPath(slug, params);
  const base = baseUrl?.replace(/\/$/, '');
  if (!base) return path;
  return `${base}${path}`;
}

export function utmFromCreative(
  creative: {
    id: string;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    utmContent?: string | null;
    utmTerm?: string | null;
  },
): MarketingUtmParams {
  return {
    utmSource: creative.utmSource,
    utmMedium: creative.utmMedium,
    utmCampaign: creative.utmCampaign,
    utmContent: creative.utmContent,
    utmTerm: creative.utmTerm,
    creativeId: creative.id,
  };
}
