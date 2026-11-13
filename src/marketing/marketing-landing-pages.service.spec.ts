import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CommercialLeadsService } from '../commercial/commercial-leads.service';
import { BrandFontsService } from '../branding/brand-fonts.service';
import { NextcloudService } from '../storage/nextcloud.service';
import { UsersService } from '../users/users.service';
import { MarketingCampaign } from './marketing-campaign.entity';
import { MarketingCreative } from './marketing-creative.entity';
import { MarketingFormSubmission } from './marketing-form-submission.entity';
import { MarketingLandingPage } from './marketing-landing-page.entity';
import { MarketingLandingPagesService } from './marketing-landing-pages.service';
import { MarketingNotificationsService } from './marketing-notifications.service';
import { MarketingPageEvent } from './marketing-page-event.entity';

function repoMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function buildDataSourceMock(repos: Record<string, ReturnType<typeof repoMock>>) {
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === MarketingLandingPage) return repos.pages;
      if (entity === MarketingFormSubmission) return repos.submissions;
      if (entity === MarketingPageEvent) return repos.events;
      if (entity === MarketingCreative) return repos.creatives;
      throw new Error('unexpected entity in transaction');
    }),
  };
  return {
    transaction: jest.fn(async (fn: (m: typeof manager) => Promise<void>) => fn(manager)),
    createQueryRunner: jest.fn(),
    query: jest.fn(),
    _manager: manager,
  };
}

describe('MarketingLandingPagesService.deactivatePage', () => {
  let service: MarketingLandingPagesService;
  const pages = repoMock();
  const submissions = repoMock();
  const events = repoMock();
  const creatives = repoMock();
  let dataSource: ReturnType<typeof buildDataSourceMock>;

  beforeEach(async () => {
    jest.clearAllMocks();
    dataSource = buildDataSourceMock({ pages, submissions, events, creatives });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingLandingPagesService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(MarketingLandingPage), useValue: pages },
        { provide: getRepositoryToken(MarketingFormSubmission), useValue: submissions },
        { provide: getRepositoryToken(MarketingPageEvent), useValue: events },
        { provide: getRepositoryToken(MarketingCampaign), useValue: repoMock() },
        { provide: getRepositoryToken(MarketingCreative), useValue: creatives },
        { provide: CommercialLeadsService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: NextcloudService, useValue: {} },
        { provide: BrandFontsService, useValue: {} },
        { provide: MarketingNotificationsService, useValue: { onMarketingFormLeadCreated: jest.fn() } },
      ],
    }).compile();

    service = module.get(MarketingLandingPagesService);
  });

  it('remove formulário sem envios do banco', async () => {
    const row = {
      id: 'page-1',
      name: 'Teste',
      active: true,
    } as MarketingLandingPage;

    pages.findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null);
    creatives.update.mockResolvedValue({ affected: 0 });
    events.delete.mockResolvedValue({ affected: 0 });
    submissions.delete.mockResolvedValue({ affected: 0 });
    pages.delete.mockResolvedValue({ affected: 1 });

    const result = await service.deactivatePage('page-1');

    expect(result).toEqual({ ok: true, removed: true });
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(creatives.update).toHaveBeenCalledWith(
      { landingPageId: 'page-1' },
      { landingPageId: null },
    );
    expect(events.delete).toHaveBeenCalledWith({ landingPageId: 'page-1' });
    expect(submissions.delete).toHaveBeenCalledWith({ landingPageId: 'page-1' });
    expect(pages.delete).toHaveBeenCalledWith({ id: 'page-1' });
    expect(pages.save).not.toHaveBeenCalled();
  });

  it('remove formulário do banco mesmo com envios existentes', async () => {
    const row = {
      id: 'page-2',
      name: 'Com envios',
      active: true,
      submissionCount: 2,
    } as MarketingLandingPage;

    pages.findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null);
    creatives.update.mockResolvedValue({ affected: 1 });
    events.delete.mockResolvedValue({ affected: 3 });
    submissions.delete.mockResolvedValue({ affected: 2 });
    pages.delete.mockResolvedValue({ affected: 1 });

    const result = await service.deactivatePage('page-2');

    expect(result).toEqual({ ok: true, removed: true });
    expect(creatives.update).toHaveBeenCalledWith(
      { landingPageId: 'page-2' },
      { landingPageId: null },
    );
    expect(events.delete).toHaveBeenCalledWith({ landingPageId: 'page-2' });
    expect(submissions.delete).toHaveBeenCalledWith({ landingPageId: 'page-2' });
    expect(pages.delete).toHaveBeenCalledWith({ id: 'page-2' });
    expect(pages.save).not.toHaveBeenCalled();
  });

  it('remove formulário inativo sem envios (métricas só de view)', async () => {
    const row = {
      id: 'page-3',
      name: 'zz teste diagnóstico',
      active: false,
      viewCount: 1,
      submissionCount: 0,
    } as MarketingLandingPage;

    pages.findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(null);
    creatives.update.mockResolvedValue({ affected: 0 });
    events.delete.mockResolvedValue({ affected: 1 });
    submissions.delete.mockResolvedValue({ affected: 0 });
    pages.delete.mockResolvedValue({ affected: 1 });

    const result = await service.deactivatePage('page-3');

    expect(result).toEqual({ ok: true, removed: true });
    expect(pages.delete).toHaveBeenCalledWith({ id: 'page-3' });
    expect(pages.save).not.toHaveBeenCalled();
  });

  it('lança 404 quando formulário não existe', async () => {
    pages.findOne.mockResolvedValue(null);
    await expect(service.deactivatePage('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lança erro quando o DELETE não remove a linha', async () => {
    const row = { id: 'page-ghost', name: 'Fantasma', active: true } as MarketingLandingPage;
    pages.findOne.mockResolvedValue(row);
    creatives.update.mockResolvedValue({ affected: 0 });
    events.delete.mockResolvedValue({ affected: 0 });
    submissions.delete.mockResolvedValue({ affected: 0 });
    pages.delete.mockResolvedValue({ affected: 0 });
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ affectedRows: 0 }),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };
    dataSource.createQueryRunner.mockReturnValue(queryRunner);

    await expect(service.deactivatePage('page-ghost')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('com force=false apenas inativa o formulário', async () => {
    const row = {
      id: 'page-soft',
      name: 'Soft',
      active: true,
    } as MarketingLandingPage;
    pages.findOne.mockResolvedValue(row);
    pages.save.mockImplementation(async (r) => r);

    const result = await service.deactivatePage('page-soft', { force: false });

    expect(result).toEqual({ ok: true, removed: false });
    expect(row.active).toBe(false);
    expect(pages.save).toHaveBeenCalledWith(row);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('falha se o registro ainda existir após exclusão bem-sucedida na transação', async () => {
    const row = { id: 'page-zombie', name: 'Zombie', active: true } as MarketingLandingPage;
    pages.findOne
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(row);
    creatives.update.mockResolvedValue({ affected: 0 });
    events.delete.mockResolvedValue({ affected: 0 });
    submissions.delete.mockResolvedValue({ affected: 0 });
    pages.delete.mockResolvedValue({ affected: 1 });

    await expect(service.deactivatePage('page-zombie')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MarketingLandingPagesService.listPages', () => {
  let service: MarketingLandingPagesService;
  const pages = repoMock();
  const submissions = repoMock();
  const campaigns = repoMock();
  const events = repoMock();
  const creatives = repoMock();

  beforeEach(async () => {
    jest.clearAllMocks();
    const dataSource = buildDataSourceMock({ pages, submissions, events, creatives });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingLandingPagesService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(MarketingLandingPage), useValue: pages },
        { provide: getRepositoryToken(MarketingFormSubmission), useValue: submissions },
        { provide: getRepositoryToken(MarketingPageEvent), useValue: events },
        { provide: getRepositoryToken(MarketingCampaign), useValue: campaigns },
        { provide: getRepositoryToken(MarketingCreative), useValue: creatives },
        { provide: CommercialLeadsService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: NextcloudService, useValue: {} },
        { provide: BrandFontsService, useValue: {} },
        { provide: MarketingNotificationsService, useValue: {} },
      ],
    }).compile();

    service = module.get(MarketingLandingPagesService);
  });

  it('expõe leadsCount agregado por formulário na listagem', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const pageA = {
      id: 'page-a',
      name: 'Alpha',
      slug: 'alpha',
      headline: 'Headline A',
      viewCount: 10,
      submissionCount: 4,
      active: true,
      campaignId: null,
      creativeId: null,
      funnelId: null,
      leadType: null,
      createdAt: now,
      updatedAt: now,
    } as MarketingLandingPage;
    const pageB = {
      id: 'page-b',
      name: 'Beta',
      slug: 'beta',
      headline: 'Headline B',
      viewCount: 5,
      submissionCount: 1,
      active: true,
      campaignId: null,
      creativeId: null,
      funnelId: null,
      leadType: null,
      createdAt: now,
      updatedAt: now,
    } as MarketingLandingPage;

    pages.find.mockResolvedValue([pageA, pageB]);

    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([{ landingPageId: 'page-a', count: '3' }]),
    };
    submissions.createQueryBuilder.mockReturnValue(queryBuilder);

    const result = await service.listPages(true);

    expect(submissions.createQueryBuilder).toHaveBeenCalledWith('submission');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('submission.landingPageId IN (:...pageIds)', {
      pageIds: ['page-a', 'page-b'],
    });
    expect(result).toHaveLength(2);
    expect(result[0].leadsCount).toBe(3);
    expect(result[1].leadsCount).toBe(0);
    expect(submissions.count).not.toHaveBeenCalled();
  });
});
