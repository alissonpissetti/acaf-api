import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import type { CommercialLeadType } from '../commercial/commercial-lead.entity';
import { CommercialLeadsService } from '../commercial/commercial-leads.service';
import { BrandFontsService } from '../branding/brand-fonts.service';
import { NextcloudService } from '../storage/nextcloud.service';
import { UsersService } from '../users/users.service';
import { MarketingCampaign } from './marketing-campaign.entity';
import { MarketingCreative } from './marketing-creative.entity';
import { MarketingFormSubmission } from './marketing-form-submission.entity';
import { MarketingLandingPage } from './marketing-landing-page.entity';
import { MarketingPageEvent } from './marketing-page-event.entity';
import {
  detectDeviceType,
  formatSourceLabel,
  normalizeUtm,
  parseMetricsRange,
} from './marketing-metrics.utils';
import {
  DEFAULT_LANDING_FIELDS,
  DEFAULT_MARKETING_THEME,
  slugifyMarketing,
  type MarketingFieldMapTo,
  type MarketingLandingField,
  type MarketingLandingTheme,
} from './marketing.types';
import { buildMarketingFormPath, utmFromCreative, type MarketingUtmParams } from './marketing-url.utils';

@Injectable()
export class MarketingLandingPagesService {
  constructor(
    @InjectRepository(MarketingLandingPage)
    private readonly pages: Repository<MarketingLandingPage>,
    @InjectRepository(MarketingFormSubmission)
    private readonly submissions: Repository<MarketingFormSubmission>,
    @InjectRepository(MarketingPageEvent)
    private readonly events: Repository<MarketingPageEvent>,
    @InjectRepository(MarketingCampaign)
    private readonly campaigns: Repository<MarketingCampaign>,
    @InjectRepository(MarketingCreative)
    private readonly creatives: Repository<MarketingCreative>,
    private readonly leads: CommercialLeadsService,
    private readonly users: UsersService,
    private readonly storage: NextcloudService,
    private readonly brandFonts: BrandFontsService,
  ) {}

  getPublicBrandTypography() {
    return this.brandFonts.getBrandTypography();
  }

  async listPages(includeInactive = false) {
    const rows = await this.pages.find({
      where: includeInactive ? {} : { active: true },
      order: { name: 'ASC' },
    });
    return Promise.all(rows.map((row) => this.pageSummaryDto(row)));
  }

  async listPageOptions(campaignId?: string) {
    const rows = await this.pages.find({
      where: { active: true },
      order: { name: 'ASC' },
    });
    const filtered = campaignId
      ? rows.filter((row) => !row.campaignId || row.campaignId === campaignId)
      : rows;
    return filtered.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      campaignId: row.campaignId,
      leadType: row.leadType,
      funnelId: row.funnelId,
    }));
  }

  async getPage(id: string) {
    const row = await this.pages.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Formulário não encontrado.');
    return this.pageDto(row);
  }

  async createPage(input: {
    name: string;
    slug?: string;
    headline: string;
    description?: string;
    thankYouMessage?: string;
    primaryColor?: string;
    logoUrl?: string | null;
    coverImageUrl?: string | null;
    theme?: MarketingLandingTheme | null;
    campaignId?: string | null;
    creativeId?: string | null;
    funnelId?: string | null;
    leadType?: CommercialLeadType | null;
    ownerUserId?: string | null;
    fields?: MarketingLandingField[];
    active?: boolean;
  }) {
    const name = input.name.trim();
    const headline = input.headline.trim();
    if (!name) throw new BadRequestException('Informe o nome do formulário.');
    if (!headline) throw new BadRequestException('Informe o título da página.');

    await this.validateRelations(input.campaignId, input.creativeId);

    const slug = await this.ensureUniquePageSlug(input.slug?.trim() || slugifyMarketing(name));
    const saved = await this.pages.save(
      this.pages.create({
        name,
        slug,
        headline,
        description: input.description?.trim() || null,
        thankYouMessage: input.thankYouMessage?.trim() || 'Recebemos seus dados. Em breve entraremos em contato.',
        primaryColor: input.primaryColor?.trim() || '#0f766e',
        logoUrl: input.logoUrl?.trim() || null,
        coverImageUrl: input.coverImageUrl?.trim() || null,
        theme: this.normalizeTheme(input.theme, input.primaryColor),
        campaignId: input.campaignId ?? null,
        creativeId: input.creativeId ?? null,
        funnelId: input.funnelId ?? null,
        leadType: input.leadType ?? null,
        ownerUserId: input.ownerUserId ?? null,
        fields: this.normalizeFields(input.fields),
        active: input.active ?? true,
      }),
    );
    if (saved.creativeId) {
      await this.creatives.update(
        { id: saved.creativeId },
        {
          landingPageId: saved.id,
          ...(saved.campaignId ? { campaignId: saved.campaignId } : {}),
        },
      );
    }
    return this.pageDto(saved);
  }

  async updatePage(
    id: string,
    input: {
      name?: string;
      slug?: string;
      headline?: string;
      description?: string | null;
      thankYouMessage?: string | null;
      primaryColor?: string;
      logoUrl?: string | null;
      coverImageUrl?: string | null;
      theme?: MarketingLandingTheme | null;
      campaignId?: string | null;
      creativeId?: string | null;
      funnelId?: string | null;
      leadType?: CommercialLeadType | null;
      ownerUserId?: string | null;
      fields?: MarketingLandingField[];
      active?: boolean;
    },
  ) {
    const row = await this.pages.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Formulário não encontrado.');

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Informe o nome do formulário.');
      row.name = name;
    }
    if (input.slug !== undefined) {
      row.slug = await this.ensureUniquePageSlug(slugifyMarketing(input.slug), row.id);
    }
    if (input.headline !== undefined) {
      const headline = input.headline.trim();
      if (!headline) throw new BadRequestException('Informe o título da página.');
      row.headline = headline;
    }
    if (input.description !== undefined) row.description = input.description?.trim() || null;
    if (input.thankYouMessage !== undefined) {
      row.thankYouMessage = input.thankYouMessage?.trim() || null;
    }
    if (input.primaryColor !== undefined) row.primaryColor = input.primaryColor?.trim() || '#0f766e';
    if (input.logoUrl !== undefined) row.logoUrl = input.logoUrl?.trim() || null;
    if (input.coverImageUrl !== undefined) row.coverImageUrl = input.coverImageUrl?.trim() || null;
    if (input.theme !== undefined) {
      row.theme = this.normalizeTheme(input.theme, row.primaryColor);
    }
    if (input.campaignId !== undefined || input.creativeId !== undefined) {
      await this.validateRelations(
        input.campaignId !== undefined ? input.campaignId : row.campaignId,
        input.creativeId !== undefined ? input.creativeId : row.creativeId,
      );
    }
    if (input.campaignId !== undefined) row.campaignId = input.campaignId;
    if (input.creativeId !== undefined) row.creativeId = input.creativeId;
    if (input.funnelId !== undefined) row.funnelId = input.funnelId;
    if (input.leadType !== undefined) row.leadType = input.leadType;
    if (input.ownerUserId !== undefined) row.ownerUserId = input.ownerUserId;
    if (input.fields !== undefined) row.fields = this.normalizeFields(input.fields);
    if (input.active !== undefined) row.active = input.active;

    const previousCreativeId = row.creativeId;

    await this.pages.save(row);

    if (input.creativeId !== undefined) {
      if (input.creativeId) {
        await this.creatives.update(
          { id: input.creativeId },
          {
            landingPageId: row.id,
            ...(row.campaignId ? { campaignId: row.campaignId } : {}),
          },
        );
      } else if (previousCreativeId) {
        await this.creatives.update({ id: previousCreativeId }, { landingPageId: null });
      }
    }
    return this.pageDto(row);
  }

  async uploadLandingPageLogo(id: string, file: Express.Multer.File) {
    const allowed = new Set(['image/png', 'image/webp', 'image/svg+xml', 'image/jpeg']);
    if (!allowed.has(file.mimetype)) {
      throw new BadRequestException('Envie o logo em PNG, WEBP, JPG ou SVG.');
    }
    const row = await this.pages.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Formulário não encontrado.');
    const { publicUrl } = await this.storage.uploadMarketingLandingAsset(id, file, 'logo');
    row.logoUrl = publicUrl;
    await this.pages.save(row);
    return this.pageDto(row);
  }

  async uploadLandingPageCover(id: string, file: Express.Multer.File) {
    const row = await this.pages.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Formulário não encontrado.');
    const { publicUrl } = await this.storage.uploadMarketingLandingAsset(id, file, 'cover');
    row.coverImageUrl = publicUrl;
    await this.pages.save(row);
    return this.pageDto(row);
  }

  async deactivatePage(id: string) {
    const row = await this.pages.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Formulário não encontrado.');
    row.active = false;
    await this.pages.save(row);
    return { ok: true };
  }

  async getPublicPage(slug: string, attribution?: MarketingUtmParams, req?: Request) {
    const row = await this.pages.findOne({ where: { slug, active: true } });
    if (!row) throw new NotFoundException('Formulário não encontrado.');

    row.viewCount += 1;
    await this.pages.save(row);
    try {
      await this.recordPageEvent(row, 'view', attribution, req);
    } catch {
      /* métricas não devem bloquear a página pública */
    }

    const campaign = row.campaignId
      ? await this.campaigns.findOne({ where: { id: row.campaignId } })
      : null;
    const creative = row.creativeId
      ? await this.creatives.findOne({ where: { id: row.creativeId } })
      : null;

    const brandTypography = await this.brandFonts.getBrandTypography();

    return {
      slug: row.slug,
      headline: row.headline,
      description: row.description,
      thankYouMessage: row.thankYouMessage,
      primaryColor: row.primaryColor,
      logoUrl: row.logoUrl,
      coverImageUrl: row.coverImageUrl,
      theme: this.resolveTheme(row),
      brandTypography,
      fields: row.fields,
      campaign: campaign
        ? { id: campaign.id, name: campaign.name, slug: campaign.slug }
        : null,
      creative: creative
        ? {
            id: creative.id,
            name: creative.name,
            slug: creative.slug,
            utmSource: creative.utmSource,
            utmMedium: creative.utmMedium,
            utmCampaign: creative.utmCampaign,
            utmContent: creative.utmContent,
            utmTerm: creative.utmTerm,
          }
        : null,
    };
  }

  async recordPublicClick(slug: string, attribution?: MarketingUtmParams, req?: Request) {
    const row = await this.pages.findOne({ where: { slug, active: true } });
    if (!row) throw new NotFoundException('Formulário não encontrado.');
    await this.recordPageEvent(row, 'click', attribution, req);
    return { ok: true };
  }

  async getPageMetrics(
    id: string,
    filters?: { from?: string; to?: string; period?: string },
  ) {
    const page = await this.pages.findOne({ where: { id } });
    if (!page) throw new NotFoundException('Formulário não encontrado.');

    const range = parseMetricsRange(filters);
    const events = await this.loadEvents(page.id, range);
    const responses = await this.loadResponses(page.id, range);
    const hasTrackedEvents = await this.events.count({ where: { landingPageId: page.id } });

    let views = events.filter((event) => event.eventType === 'view').length;
    let clicks = events.filter((event) => event.eventType === 'click').length;
    let responseRows = responses;
    if (!hasTrackedEvents && !range.from && !range.to) {
      views = page.viewCount;
      clicks = 0;
      if (!responseRows.length && page.submissionCount > 0) {
        responseRows = await this.submissions.find({
          where: { landingPageId: page.id },
          order: { createdAt: 'DESC' },
        });
      }
    }

    const leads = responseRows.filter((response) => Boolean(response.leadId)).length;

    const viewsByDayMap = new Map<string, { views: number; clicks: number }>();
    for (const event of events) {
      const key = event.createdAt.toISOString().slice(0, 10);
      const current = viewsByDayMap.get(key) ?? { views: 0, clicks: 0 };
      if (event.eventType === 'click') current.clicks += 1;
      else current.views += 1;
      viewsByDayMap.set(key, current);
    }

    const viewsByDay = [...viewsByDayMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, totals]) => ({
        date,
        views: totals.views,
        clicks: totals.clicks,
      }));

    const bySourceMap = new Map<
      string,
      { label: string; utmSource: string | null; utmMedium: string | null; views: number; clicks: number }
    >();
    for (const event of events) {
      const key = `${event.utmSource ?? ''}|${event.utmMedium ?? ''}`;
      const current = bySourceMap.get(key) ?? {
        label: formatSourceLabel(event.utmSource, event.utmMedium),
        utmSource: event.utmSource,
        utmMedium: event.utmMedium,
        views: 0,
        clicks: 0,
      };
      if (event.eventType === 'click') current.clicks += 1;
      else current.views += 1;
      bySourceMap.set(key, current);
    }

    const bySource = [...bySourceMap.values()]
      .map((row) => ({
        ...row,
        ctr: row.views > 0 ? Number(((row.clicks / row.views) * 100).toFixed(1)) : 0,
      }))
      .sort((left, right) => right.views - left.views);

    const creatives = page.campaignId
      ? await this.creatives.find({ where: { campaignId: page.campaignId, active: true } })
      : await this.creatives.find({ where: { landingPageId: page.id, active: true } });
    const creativeMap = new Map(creatives.map((creative) => [creative.id, creative.name]));

    const byLinkMap = new Map<
      string,
      { creativeId: string | null; label: string; views: number; clicks: number }
    >();
    for (const event of events) {
      const creativeId = event.creativeId ?? null;
      const key = creativeId ?? 'direct';
      const current = byLinkMap.get(key) ?? {
        creativeId,
        label: creativeId ? creativeMap.get(creativeId) ?? 'Criativo' : 'Acesso direto',
        views: 0,
        clicks: 0,
      };
      if (event.eventType === 'click') current.clicks += 1;
      else current.views += 1;
      byLinkMap.set(key, current);
    }

    const byLink = [...byLinkMap.values()]
      .map((row) => ({
        ...row,
        ctr: row.views > 0 ? Number(((row.clicks / row.views) * 100).toFixed(1)) : 0,
      }))
      .sort((left, right) => right.views - left.views);

    const deviceCounts = { mobile: 0, desktop: 0, tablet: 0 };
    for (const event of events.filter((item) => item.eventType === 'view')) {
      deviceCounts[detectDeviceType(event.userAgent)] += 1;
    }
    const deviceTotal = deviceCounts.mobile + deviceCounts.desktop + deviceCounts.tablet;
    const byDevice = {
      mobile: deviceTotal ? Number(((deviceCounts.mobile / deviceTotal) * 100).toFixed(1)) : 0,
      desktop: deviceTotal ? Number(((deviceCounts.desktop / deviceTotal) * 100).toFixed(1)) : 0,
      tablet: deviceTotal ? Number(((deviceCounts.tablet / deviceTotal) * 100).toFixed(1)) : 0,
    };

    const fieldLabels = new Map(
      page.fields
        .filter((field) => field.kind !== 'section')
        .map((field) => [field.key, field.label]),
    );

    return {
      page: {
        id: page.id,
        name: page.name,
        slug: page.slug,
        headline: page.headline,
      },
      range: {
        from: range.from?.toISOString().slice(0, 10) ?? null,
        to: range.to?.toISOString().slice(0, 10) ?? null,
      },
      totals: {
        views,
        clicks,
        ctr: views > 0 ? Number(((clicks / views) * 100).toFixed(1)) : 0,
        leads,
        responses: responseRows.length,
      },
      viewsByDay,
      bySource,
      byLink,
      byDevice,
      fields: page.fields.filter((field) => field.kind !== 'section'),
      responses: responseRows.map((response) => ({
        id: response.id,
        createdAt: response.createdAt.toISOString(),
        leadId: response.leadId,
        data: Object.fromEntries(
          Object.entries(response.data ?? {}).map(([key, value]) => [
            fieldLabels.get(key) ?? key,
            value,
          ]),
        ),
      })),
    };
  }

  async clearPageMetrics(id: string) {
    const page = await this.pages.findOne({ where: { id } });
    if (!page) throw new NotFoundException('Formulário não encontrado.');

    await this.events.delete({ landingPageId: page.id });
    await this.submissions.delete({ landingPageId: page.id });
    page.viewCount = 0;
    page.submissionCount = 0;
    await this.pages.save(page);
    return { ok: true };
  }

  async submitPublicForm(
    slug: string,
    body: {
      data?: Record<string, string>;
      creativeId?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmContent?: string;
      utmTerm?: string;
    },
    req: Request,
  ) {
    const page = await this.pages.findOne({ where: { slug, active: true } });
    if (!page) throw new NotFoundException('Formulário não encontrado.');

    const data = body.data ?? {};
    this.validateSubmission(page.fields, data);

    const creativeId = body.creativeId?.trim() || page.creativeId;
    const creative = creativeId
      ? await this.creatives.findOne({ where: { id: creativeId } })
      : null;

    const mapped = this.mapSubmissionToLead(page.fields, data);
    const ownerUserId = await this.resolveOwnerUserId(page.ownerUserId);
    const attribution = await this.buildAttributionNotes(page, body, creative);

    const lead = await this.leads.create(
      {
        title: mapped.title || mapped.contactName || 'Lead de marketing',
        type: page.leadType,
        source: 'marketing_form',
        funnelId: page.funnelId ?? undefined,
        legalName: mapped.legalName,
        cnpj: mapped.cnpj,
        email: mapped.email,
        phone: mapped.phone,
        contactName: mapped.contactName,
        notes: [mapped.notes, attribution].filter(Boolean).join('\n\n'),
        ownerUserId,
        temperature: 'warm',
      },
      ownerUserId,
    );

    const submission = await this.submissions.save(
      this.submissions.create({
        landingPageId: page.id,
        campaignId: creative?.campaignId ?? page.campaignId,
        creativeId: creative?.id ?? page.creativeId,
        leadId: lead.id,
        data,
        utmSource: body.utmSource?.trim() || null,
        utmMedium: body.utmMedium?.trim() || null,
        utmCampaign: body.utmCampaign?.trim() || null,
        utmContent: body.utmContent?.trim() || null,
        utmTerm: body.utmTerm?.trim() || null,
        referrer: req.headers.referer?.slice(0, 500) ?? null,
        userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
        ipAddress: this.extractIp(req),
      }),
    );

    page.submissionCount += 1;
    await this.pages.save(page);

    if (creative?.id ?? page.creativeId) {
      await this.creatives.increment({ id: creative?.id ?? page.creativeId! }, 'conversions', 1);
    }

    await this.leads.addInteraction(
      lead.id,
      ownerUserId,
      `Lead captado pelo formulário "${page.name}" (${page.slug}).`,
    );

    return {
      ok: true,
      submissionId: submission.id,
      leadId: lead.id,
      thankYouMessage:
        page.thankYouMessage || 'Recebemos seus dados. Em breve entraremos em contato.',
    };
  }

  async getDashboardStats() {
    const [campaignCount, pageCount, submissionCount] = await Promise.all([
      this.campaigns.count({ where: { active: true } }),
      this.pages.count({ where: { active: true } }),
      this.submissions.count(),
    ]);

    const creativeMetrics = await this.creatives
      .createQueryBuilder('creative')
      .select('COALESCE(SUM(creative.impressions), 0)', 'impressions')
      .addSelect('COALESCE(SUM(creative.clicks), 0)', 'clicks')
      .addSelect('COALESCE(SUM(creative.spendCents), 0)', 'spendCents')
      .addSelect('COALESCE(SUM(creative.conversions), 0)', 'conversions')
      .getRawOne<{ impressions: string; clicks: string; spendCents: string; conversions: string }>();

    const impressions = Number(creativeMetrics?.impressions ?? 0);
    const clicks = Number(creativeMetrics?.clicks ?? 0);
    const spendCents = Number(creativeMetrics?.spendCents ?? 0);
    const conversions = Number(creativeMetrics?.conversions ?? 0);

    const topCampaigns = await this.campaigns.find({
      where: { active: true },
      order: { updatedAt: 'DESC' },
      take: 5,
    });

    const topPages = await this.pages.find({
      where: { active: true },
      order: { submissionCount: 'DESC' },
      take: 5,
    });

    const recentSubmissions = await this.submissions.find({
      order: { createdAt: 'DESC' },
      take: 8,
    });

    const pageMap = new Map(
      (await this.pages.find()).map((page) => [page.id, page.name]),
    );
    const campaignMap = new Map(
      (await this.campaigns.find()).map((campaign) => [campaign.id, campaign.name]),
    );

    return {
      totals: {
        campaigns: campaignCount,
        landingPages: pageCount,
        submissions: submissionCount,
        impressions,
        clicks,
        spendCents,
        conversions,
        ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
        conversionRate: clicks > 0 ? Number(((conversions / clicks) * 100).toFixed(2)) : 0,
      },
      topCampaigns: await Promise.all(
        topCampaigns.map(async (campaign) => {
          const metrics = await this.creatives
            .createQueryBuilder('creative')
            .select('COALESCE(SUM(creative.conversions), 0)', 'conversions')
            .where('creative.campaignId = :campaignId', { campaignId: campaign.id })
            .getRawOne<{ conversions: string }>();
          return {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            submissions: await this.submissions.count({ where: { campaignId: campaign.id } }),
            conversions: Number(metrics?.conversions ?? 0),
          };
        }),
      ),
      topLandingPages: topPages.map((page) => ({
        id: page.id,
        name: page.name,
        slug: page.slug,
        views: page.viewCount,
        submissions: page.submissionCount,
        conversionRate:
          page.viewCount > 0
            ? Number(((page.submissionCount / page.viewCount) * 100).toFixed(2))
            : 0,
      })),
      recentSubmissions: recentSubmissions.map((submission) => ({
        id: submission.id,
        landingPageName: pageMap.get(submission.landingPageId) ?? 'Formulário',
        campaignName: submission.campaignId
          ? campaignMap.get(submission.campaignId) ?? null
          : null,
        leadId: submission.leadId,
        createdAt: submission.createdAt.toISOString(),
      })),
    };
  }

  private async pageSummaryDto(row: MarketingLandingPage) {
    const campaign = row.campaignId
      ? await this.campaigns.findOne({ where: { id: row.campaignId } })
      : null;
    const creative = row.creativeId
      ? await this.creatives.findOne({ where: { id: row.creativeId } })
      : null;

    const sharePath = creative
      ? buildMarketingFormPath(row.slug, utmFromCreative(creative))
      : buildMarketingFormPath(row.slug);

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      headline: row.headline,
      campaignId: row.campaignId,
      campaignName: campaign?.name ?? null,
      creativeId: row.creativeId,
      creativeName: creative?.name ?? null,
      funnelId: row.funnelId,
      leadType: row.leadType,
      leadTypeLabel:
        row.leadType === 'partner'
          ? 'Academia'
          : row.leadType === 'corporate'
            ? 'Empresa'
            : null,
      viewCount: row.viewCount,
      submissionCount: row.submissionCount,
      conversionRate:
        row.viewCount > 0
          ? Number(((row.submissionCount / row.viewCount) * 100).toFixed(2))
          : 0,
      active: row.active,
      publicUrl: `/f/${row.slug}`,
      sharePath,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async pageDto(row: MarketingLandingPage) {
    return {
      ...(await this.pageSummaryDto(row)),
      description: row.description,
      thankYouMessage: row.thankYouMessage,
      primaryColor: row.primaryColor,
      logoUrl: row.logoUrl,
      coverImageUrl: row.coverImageUrl,
      theme: this.resolveTheme(row),
      ownerUserId: row.ownerUserId,
      fields: row.fields,
    };
  }

  private resolveTheme(row: MarketingLandingPage): MarketingLandingTheme {
    const stored = (row.theme ?? {}) as MarketingLandingTheme;
    return {
      ...DEFAULT_MARKETING_THEME,
      ...stored,
      buttonColor: stored.buttonColor ?? row.primaryColor ?? DEFAULT_MARKETING_THEME.buttonColor,
    };
  }

  private normalizeTheme(
    theme?: MarketingLandingTheme | null,
    primaryColor?: string,
  ): MarketingLandingTheme {
    const merged = {
      ...DEFAULT_MARKETING_THEME,
      ...(theme ?? {}),
    };
    if (primaryColor?.trim()) {
      merged.buttonColor = primaryColor.trim();
    }
    return merged;
  }

  private formFields(fields: MarketingLandingField[]) {
    return fields.filter((field) => field.kind !== 'section');
  }

  private normalizeFields(fields?: MarketingLandingField[]): MarketingLandingField[] {
    const source = fields?.length ? fields : DEFAULT_LANDING_FIELDS;
    return source.map((field, index) => {
      const kind = field.kind === 'section' ? 'section' : 'field';
      if (kind === 'section') {
        const sectionStyle: 'default' | 'highlight' =
          field.sectionStyle === 'highlight' ? 'highlight' : 'default';
        return {
          key: field.key?.trim() || `section_${index + 1}`,
          label: field.label?.trim() || `Seção ${index + 1}`,
          kind: 'section' as const,
          sectionStyle,
        };
      }
      return {
        key: field.key?.trim() || `field_${index + 1}`,
        label: field.label?.trim() || `Campo ${index + 1}`,
        kind: 'field' as const,
        type: field.type ?? 'text',
        required: Boolean(field.required),
        placeholder: field.placeholder?.trim() || undefined,
        description: field.description?.trim() || undefined,
        mapTo: field.mapTo,
      };
    });
  }

  private validateSubmission(fields: MarketingLandingField[], data: Record<string, string>) {
    for (const field of this.formFields(fields)) {
      const value = String(data[field.key] ?? '').trim();
      if (field.required && !value) {
        throw new BadRequestException(`Informe ${field.label.toLowerCase()}.`);
      }
      if (field.type === 'email' && value && !value.includes('@')) {
        throw new BadRequestException('Informe um e-mail válido.');
      }
    }
  }

  private mapSubmissionToLead(fields: MarketingLandingField[], data: Record<string, string>) {
    const lead: Partial<Record<MarketingFieldMapTo, string>> = {};
    for (const field of this.formFields(fields)) {
      const value = String(data[field.key] ?? '').trim();
      if (!value || !field.mapTo) continue;
      lead[field.mapTo] = lead[field.mapTo] ? `${lead[field.mapTo]}\n${value}` : value;
    }
    return {
      title: lead.title ?? '',
      contactName: lead.contactName ?? '',
      email: lead.email ?? '',
      phone: lead.phone ?? '',
      legalName: lead.legalName ?? '',
      cnpj: lead.cnpj ?? '',
      notes: lead.notes ?? '',
    };
  }

  private async buildAttributionNotes(
    page: MarketingLandingPage,
    body: {
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmContent?: string;
      utmTerm?: string;
    },
    creative?: MarketingCreative | null,
  ) {
    const lines = [`Origem: formulário ${page.name} (${page.slug})`];
    if (page.campaignId) {
      const campaign = await this.campaigns.findOne({ where: { id: page.campaignId } });
      if (campaign) lines.push(`Campanha: ${campaign.name}`);
    }
    const creativeRow =
      creative ??
      (page.creativeId
        ? await this.creatives.findOne({ where: { id: page.creativeId } })
        : null);
    if (creativeRow) lines.push(`Criativo: ${creativeRow.name}`);
    const utmParts = [
      body.utmSource ? `source=${body.utmSource}` : null,
      body.utmMedium ? `medium=${body.utmMedium}` : null,
      body.utmCampaign ? `campaign=${body.utmCampaign}` : null,
      body.utmContent ? `content=${body.utmContent}` : null,
      body.utmTerm ? `term=${body.utmTerm}` : null,
    ].filter(Boolean);
    if (utmParts.length) lines.push(`UTM: ${utmParts.join(' | ')}`);
    return lines.join('\n');
  }

  private async resolveOwnerUserId(ownerUserId: string | null) {
    if (ownerUserId) return ownerUserId;
    const admins = await this.users.findAll();
    const firstAdmin = admins.find((user) => user.active);
    if (!firstAdmin) {
      throw new BadRequestException('Nenhum usuário admin disponível para receber o lead.');
    }
    return firstAdmin.id;
  }

  private async validateRelations(campaignId?: string | null, creativeId?: string | null) {
    if (campaignId) {
      const campaign = await this.campaigns.findOne({ where: { id: campaignId } });
      if (!campaign) throw new BadRequestException('Campanha inválida.');
    }
    if (creativeId) {
      const creative = await this.creatives.findOne({ where: { id: creativeId } });
      if (!creative) throw new BadRequestException('Criativo inválido.');
      if (campaignId && creative.campaignId !== campaignId) {
        throw new BadRequestException('O criativo não pertence à campanha selecionada.');
      }
    }
  }

  private async ensureUniquePageSlug(base: string, excludeId?: string) {
    const slugBase = base || 'formulario';
    let slug = slugBase;
    let suffix = 2;
    while (true) {
      const existing = await this.pages.findOne({ where: { slug } });
      if (!existing || existing.id === excludeId) return slug;
      slug = `${slugBase}-${suffix}`;
      suffix += 1;
    }
  }

  private extractIp(req: Request) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length) {
      return forwarded.split(',')[0]?.trim().slice(0, 64) ?? null;
    }
    return req.ip?.slice(0, 64) ?? null;
  }

  private async recordPageEvent(
    page: MarketingLandingPage,
    eventType: 'view' | 'click',
    attribution?: MarketingUtmParams,
    req?: Request,
  ) {
    const utm = normalizeUtm(attribution);
    await this.events.save(
      this.events.create({
        landingPageId: page.id,
        creativeId: utm.creativeId ?? page.creativeId,
        eventType,
        utmSource: utm.utmSource,
        utmMedium: utm.utmMedium,
        utmCampaign: utm.utmCampaign,
        utmContent: utm.utmContent,
        utmTerm: utm.utmTerm,
        referrer: req?.headers.referer?.slice(0, 500) ?? null,
        userAgent: req?.headers['user-agent']?.slice(0, 500) ?? null,
        ipAddress: req ? this.extractIp(req) : null,
      }),
    );
  }

  private applyDateRange<T extends { createdAt: Date }>(
    query: ReturnType<Repository<T>['createQueryBuilder']>,
    alias: string,
    range: ReturnType<typeof parseMetricsRange>,
  ) {
    if (range.from) {
      query.andWhere(`${alias}.createdAt >= :fromDate`, { fromDate: range.from });
    }
    if (range.to) {
      query.andWhere(`${alias}.createdAt <= :toDate`, { toDate: range.to });
    }
    return query;
  }

  private async loadEvents(pageId: string, range: ReturnType<typeof parseMetricsRange>) {
    const query = this.events
      .createQueryBuilder('event')
      .where('event.landingPageId = :pageId', { pageId })
      .orderBy('event.createdAt', 'ASC');
    this.applyDateRange(query, 'event', range);
    return query.getMany();
  }

  private async loadResponses(pageId: string, range: ReturnType<typeof parseMetricsRange>) {
    const query = this.submissions
      .createQueryBuilder('submission')
      .where('submission.landingPageId = :pageId', { pageId })
      .orderBy('submission.createdAt', 'DESC');
    this.applyDateRange(query, 'submission', range);
    return query.getMany();
  }
}
