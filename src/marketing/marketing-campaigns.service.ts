import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MarketingCampaign } from './marketing-campaign.entity';
import { MarketingCreative } from './marketing-creative.entity';
import { MarketingFormSubmission } from './marketing-form-submission.entity';
import { MarketingLandingPage } from './marketing-landing-page.entity';
import {
  slugifyMarketing,
  type MarketingCampaignStatus,
  type MarketingCreativeFormat,
  type MarketingPlatform,
} from './marketing.types';
import { buildMarketingFormPath, utmFromCreative } from './marketing-url.utils';

const PLATFORM_LABELS: Record<MarketingPlatform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  google: 'Google',
  youtube: 'YouTube',
  other: 'Outro',
};

const STATUS_LABELS: Record<MarketingCampaignStatus, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  finished: 'Encerrada',
};

const FORMAT_LABELS: Record<MarketingCreativeFormat, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  carousel: 'Carrossel',
  story: 'Story',
  reels: 'Reels',
  search: 'Busca',
  other: 'Outro',
};

@Injectable()
export class MarketingCampaignsService {
  constructor(
    @InjectRepository(MarketingCampaign)
    private readonly campaigns: Repository<MarketingCampaign>,
    @InjectRepository(MarketingCreative)
    private readonly creatives: Repository<MarketingCreative>,
    @InjectRepository(MarketingFormSubmission)
    private readonly submissions: Repository<MarketingFormSubmission>,
    @InjectRepository(MarketingLandingPage)
    private readonly landingPages: Repository<MarketingLandingPage>,
  ) {}

  async listCampaigns(includeInactive = false) {
    const rows = await this.campaigns.find({
      where: includeInactive ? {} : { active: true },
      order: { status: 'ASC', name: 'ASC' },
    });
    return Promise.all(rows.map((row) => this.campaignSummaryDto(row)));
  }

  async listCampaignOptions() {
    const rows = await this.campaigns.find({
      where: { active: true },
      order: { name: 'ASC' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      platform: row.platform,
      platformLabel: PLATFORM_LABELS[row.platform] ?? row.platform,
    }));
  }

  async getCampaign(id: string) {
    const row = await this.campaigns.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Campanha não encontrada.');
    const creativeRows = await this.creatives.find({
      where: { campaignId: id },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return {
      ...(await this.campaignSummaryDto(row)),
      notes: row.notes,
      ownerUserId: row.ownerUserId,
      creatives: await Promise.all(creativeRows.map((creative) => this.creativeDto(creative))),
    };
  }

  async createCampaign(input: {
    name: string;
    slug?: string;
    description?: string;
    platform?: MarketingPlatform;
    status?: MarketingCampaignStatus;
    startDate?: string | null;
    endDate?: string | null;
    budgetCents?: number;
    notes?: string;
    ownerUserId?: string | null;
    active?: boolean;
  }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Informe o nome da campanha.');

    const slug = await this.ensureUniqueCampaignSlug(input.slug?.trim() || slugifyMarketing(name));
    const saved = await this.campaigns.save(
      this.campaigns.create({
        name,
        slug,
        description: input.description?.trim() || null,
        platform: input.platform ?? 'other',
        status: input.status ?? 'draft',
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        budgetCents: input.budgetCents ?? 0,
        notes: input.notes?.trim() || null,
        ownerUserId: input.ownerUserId ?? null,
        active: input.active ?? true,
      }),
    );
    return this.getCampaign(saved.id);
  }

  async updateCampaign(
    id: string,
    input: {
      name?: string;
      slug?: string;
      description?: string | null;
      platform?: MarketingPlatform;
      status?: MarketingCampaignStatus;
      startDate?: string | null;
      endDate?: string | null;
      budgetCents?: number;
      notes?: string | null;
      ownerUserId?: string | null;
      active?: boolean;
    },
  ) {
    const row = await this.campaigns.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Campanha não encontrada.');

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Informe o nome da campanha.');
      row.name = name;
    }
    if (input.slug !== undefined) {
      row.slug = await this.ensureUniqueCampaignSlug(
        slugifyMarketing(input.slug),
        row.id,
      );
    }
    if (input.description !== undefined) row.description = input.description?.trim() || null;
    if (input.platform !== undefined) row.platform = input.platform;
    if (input.status !== undefined) row.status = input.status;
    if (input.startDate !== undefined) row.startDate = input.startDate;
    if (input.endDate !== undefined) row.endDate = input.endDate;
    if (input.budgetCents !== undefined) row.budgetCents = input.budgetCents;
    if (input.notes !== undefined) row.notes = input.notes?.trim() || null;
    if (input.ownerUserId !== undefined) row.ownerUserId = input.ownerUserId;
    if (input.active !== undefined) row.active = input.active;

    await this.campaigns.save(row);
    return this.getCampaign(id);
  }

  async deactivateCampaign(id: string) {
    const row = await this.campaigns.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Campanha não encontrada.');
    row.active = false;
    row.status = 'finished';
    await this.campaigns.save(row);
    return { ok: true };
  }

  async createCreative(
    campaignId: string,
    input: {
      name: string;
      slug?: string;
      platform?: MarketingPlatform;
      format?: MarketingCreativeFormat;
      externalUrl?: string | null;
      landingPageId?: string | null;
      utmSource?: string | null;
      utmMedium?: string | null;
      utmCampaign?: string | null;
      utmContent?: string | null;
      utmTerm?: string | null;
      impressions?: number;
      clicks?: number;
      spendCents?: number;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    const campaign = await this.campaigns.findOne({ where: { id: campaignId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');

    const name = input.name.trim();
    if (!name) throw new BadRequestException('Informe o nome do criativo.');

    const slug = await this.ensureUniqueCreativeSlug(
      campaignId,
      input.slug?.trim() || slugifyMarketing(name),
    );

    const saved = await this.creatives.save(
      this.creatives.create({
        campaignId,
        name,
        slug,
        platform: input.platform ?? campaign.platform,
        format: input.format ?? 'image',
        externalUrl: input.externalUrl?.trim() || null,
        landingPageId: input.landingPageId ?? null,
        utmSource: input.utmSource?.trim() || campaign.slug,
        utmMedium: input.utmMedium?.trim() || 'social',
        utmCampaign: input.utmCampaign?.trim() || campaign.slug,
        utmContent: input.utmContent?.trim() || slug,
        utmTerm: input.utmTerm?.trim() || null,
        impressions: input.impressions ?? 0,
        clicks: input.clicks ?? 0,
        spendCents: input.spendCents ?? 0,
        conversions: 0,
        sortOrder: input.sortOrder ?? 0,
        active: input.active ?? true,
      }),
    );
    await this.syncCreativeLandingPage(saved, input.landingPageId ?? null);
    return this.creativeDto(saved);
  }

  async updateCreative(
    campaignId: string,
    creativeId: string,
    input: {
      name?: string;
      slug?: string;
      platform?: MarketingPlatform;
      format?: MarketingCreativeFormat;
      externalUrl?: string | null;
      landingPageId?: string | null;
      utmSource?: string | null;
      utmMedium?: string | null;
      utmCampaign?: string | null;
      utmContent?: string | null;
      utmTerm?: string | null;
      impressions?: number;
      clicks?: number;
      spendCents?: number;
      sortOrder?: number;
      active?: boolean;
    },
  ) {
    const row = await this.creatives.findOne({ where: { id: creativeId, campaignId } });
    if (!row) throw new NotFoundException('Criativo não encontrado.');

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Informe o nome do criativo.');
      row.name = name;
    }
    if (input.slug !== undefined) {
      row.slug = await this.ensureUniqueCreativeSlug(
        campaignId,
        slugifyMarketing(input.slug),
        row.id,
      );
    }
    if (input.platform !== undefined) row.platform = input.platform;
    if (input.format !== undefined) row.format = input.format;
    if (input.externalUrl !== undefined) row.externalUrl = input.externalUrl?.trim() || null;
    if (input.landingPageId !== undefined) row.landingPageId = input.landingPageId;
    if (input.utmSource !== undefined) row.utmSource = input.utmSource?.trim() || null;
    if (input.utmMedium !== undefined) row.utmMedium = input.utmMedium?.trim() || null;
    if (input.utmCampaign !== undefined) row.utmCampaign = input.utmCampaign?.trim() || null;
    if (input.utmContent !== undefined) row.utmContent = input.utmContent?.trim() || null;
    if (input.utmTerm !== undefined) row.utmTerm = input.utmTerm?.trim() || null;
    if (input.impressions !== undefined) row.impressions = input.impressions;
    if (input.clicks !== undefined) row.clicks = input.clicks;
    if (input.spendCents !== undefined) row.spendCents = input.spendCents;
    if (input.sortOrder !== undefined) row.sortOrder = input.sortOrder;
    if (input.active !== undefined) row.active = input.active;

    await this.creatives.save(row);
    if (input.landingPageId !== undefined) {
      await this.syncCreativeLandingPage(row, input.landingPageId);
    }
    return this.creativeDto(row);
  }

  async deactivateCreative(campaignId: string, creativeId: string) {
    const row = await this.creatives.findOne({ where: { id: creativeId, campaignId } });
    if (!row) throw new NotFoundException('Criativo não encontrado.');
    row.active = false;
    await this.creatives.save(row);
    return { ok: true };
  }

  private async campaignSummaryDto(row: MarketingCampaign) {
    const creativeCount = await this.creatives.count({ where: { campaignId: row.id, active: true } });
    const submissionCount = await this.submissions.count({ where: { campaignId: row.id } });
    const metrics = await this.creatives
      .createQueryBuilder('creative')
      .select('COALESCE(SUM(creative.impressions), 0)', 'impressions')
      .addSelect('COALESCE(SUM(creative.clicks), 0)', 'clicks')
      .addSelect('COALESCE(SUM(creative.spendCents), 0)', 'spendCents')
      .addSelect('COALESCE(SUM(creative.conversions), 0)', 'conversions')
      .where('creative.campaignId = :campaignId', { campaignId: row.id })
      .getRawOne<{ impressions: string; clicks: string; spendCents: string; conversions: string }>();

    const impressions = Number(metrics?.impressions ?? 0);
    const clicks = Number(metrics?.clicks ?? 0);
    const spendCents = Number(metrics?.spendCents ?? 0);
    const conversions = Number(metrics?.conversions ?? 0);

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      platform: row.platform,
      platformLabel: PLATFORM_LABELS[row.platform] ?? row.platform,
      status: row.status,
      statusLabel: STATUS_LABELS[row.status] ?? row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      budgetCents: row.budgetCents,
      active: row.active,
      creativeCount,
      submissionCount,
      impressions,
      clicks,
      spendCents,
      conversions,
      ctr: impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0,
      conversionRate: clicks > 0 ? Number(((conversions / clicks) * 100).toFixed(2)) : 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async creativeDto(row: MarketingCreative) {
    const submissionCount = await this.submissions.count({ where: { creativeId: row.id } });
    const landingPage = row.landingPageId
      ? await this.landingPages.findOne({ where: { id: row.landingPageId } })
      : await this.landingPages.findOne({ where: { creativeId: row.id, active: true } });

    const formPath = landingPage
      ? buildMarketingFormPath(landingPage.slug, utmFromCreative(row))
      : null;

    return {
      id: row.id,
      campaignId: row.campaignId,
      name: row.name,
      slug: row.slug,
      platform: row.platform,
      platformLabel: PLATFORM_LABELS[row.platform] ?? row.platform,
      format: row.format,
      formatLabel: FORMAT_LABELS[row.format] ?? row.format,
      externalUrl: row.externalUrl,
      landingPageId: row.landingPageId ?? landingPage?.id ?? null,
      landingPageName: landingPage?.name ?? null,
      landingPageSlug: landingPage?.slug ?? null,
      formPath,
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
      utmContent: row.utmContent,
      utmTerm: row.utmTerm,
      impressions: row.impressions,
      clicks: row.clicks,
      spendCents: row.spendCents,
      conversions: row.conversions,
      submissionCount,
      ctr: row.impressions > 0 ? Number(((row.clicks / row.impressions) * 100).toFixed(2)) : 0,
      conversionRate:
        row.clicks > 0 ? Number(((row.conversions / row.clicks) * 100).toFixed(2)) : 0,
      sortOrder: row.sortOrder,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async ensureUniqueCampaignSlug(base: string, excludeId?: string) {
    const slugBase = base || 'campanha';
    let slug = slugBase;
    let suffix = 2;
    while (true) {
      const existing = await this.campaigns.findOne({ where: { slug } });
      if (!existing || existing.id === excludeId) return slug;
      slug = `${slugBase}-${suffix}`;
      suffix += 1;
    }
  }

  private async ensureUniqueCreativeSlug(campaignId: string, base: string, excludeId?: string) {
    const slugBase = base || 'criativo';
    let slug = slugBase;
    let suffix = 2;
    while (true) {
      const existing = await this.creatives.findOne({ where: { campaignId, slug } });
      if (!existing || existing.id === excludeId) return slug;
      slug = `${slugBase}-${suffix}`;
      suffix += 1;
    }
  }

  private async syncCreativeLandingPage(
    creative: MarketingCreative,
    landingPageId: string | null,
  ) {
    if (landingPageId) {
      const page = await this.landingPages.findOne({ where: { id: landingPageId } });
      if (!page) throw new BadRequestException('Formulário inválido.');
      page.campaignId = creative.campaignId;
      page.creativeId = creative.id;
      await this.landingPages.save(page);
      return;
    }

    const linked = await this.landingPages.find({ where: { creativeId: creative.id } });
    for (const page of linked) {
      if (page.creativeId === creative.id) {
        page.creativeId = null;
        await this.landingPages.save(page);
      }
    }
  }
}
