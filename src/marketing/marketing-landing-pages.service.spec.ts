import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CommercialLeadsService } from '../commercial/commercial-leads.service';
import { BrandFontsService } from '../branding/brand-fonts.service';
import { NextcloudService } from '../storage/nextcloud.service';
import { UsersService } from '../users/users.service';
import { MarketingCampaign } from './marketing-campaign.entity';
import { MarketingCreative } from './marketing-creative.entity';
import { MarketingFormSubmission } from './marketing-form-submission.entity';
import { MarketingLandingPage } from './marketing-landing-page.entity';
import { MarketingLandingPagesService } from './marketing-landing-pages.service';
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

describe('MarketingLandingPagesService.deactivatePage', () => {
  let service: MarketingLandingPagesService;
  const pages = repoMock();
  const submissions = repoMock();
  const events = repoMock();
  const creatives = repoMock();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingLandingPagesService,
        { provide: getRepositoryToken(MarketingLandingPage), useValue: pages },
        { provide: getRepositoryToken(MarketingFormSubmission), useValue: submissions },
        { provide: getRepositoryToken(MarketingPageEvent), useValue: events },
        { provide: getRepositoryToken(MarketingCampaign), useValue: repoMock() },
        { provide: getRepositoryToken(MarketingCreative), useValue: creatives },
        { provide: CommercialLeadsService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: NextcloudService, useValue: {} },
        { provide: BrandFontsService, useValue: {} },
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

    pages.findOne.mockResolvedValue(row);
    creatives.update.mockResolvedValue({ affected: 0 });
    events.delete.mockResolvedValue({ affected: 0 });
    submissions.delete.mockResolvedValue({ affected: 0 });
    pages.delete.mockResolvedValue({ affected: 1 });

    const result = await service.deactivatePage('page-1');

    expect(result).toEqual({ ok: true, removed: true });
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

    pages.findOne.mockResolvedValue(row);
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

    pages.findOne.mockResolvedValue(row);
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

    await expect(service.deactivatePage('page-ghost')).rejects.toBeInstanceOf(BadRequestException);
  });
});
