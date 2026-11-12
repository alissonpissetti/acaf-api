import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MarketingCampaign } from './marketing-campaign.entity';
import { MarketingCampaignsService } from './marketing-campaigns.service';
import { MarketingCreative } from './marketing-creative.entity';
import { MarketingFormSubmission } from './marketing-form-submission.entity';
import { MarketingLandingPage } from './marketing-landing-page.entity';

function repoMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

describe('MarketingCampaignsService.deactivateCampaign', () => {
  let service: MarketingCampaignsService;
  const campaigns = repoMock();
  const creatives = repoMock();
  const submissions = repoMock();
  const landingPages = repoMock();

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingCampaignsService,
        { provide: getRepositoryToken(MarketingCampaign), useValue: campaigns },
        { provide: getRepositoryToken(MarketingCreative), useValue: creatives },
        { provide: getRepositoryToken(MarketingFormSubmission), useValue: submissions },
        { provide: getRepositoryToken(MarketingLandingPage), useValue: landingPages },
      ],
    }).compile();

    service = module.get(MarketingCampaignsService);
  });

  it('remove campanha sem leads do banco', async () => {
    const row = {
      id: 'camp-1',
      name: 'Teste',
      active: true,
      status: 'draft',
    } as MarketingCampaign;

    campaigns.findOne.mockResolvedValue(row);
    submissions.count.mockResolvedValue(0);
    creatives.find.mockResolvedValue([]);
    campaigns.delete.mockResolvedValue({ affected: 1 });

    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    landingPages.createQueryBuilder.mockReturnValue(qb);

    const result = await service.deactivateCampaign('camp-1');

    expect(result).toEqual({ ok: true, removed: true });
    expect(campaigns.delete).toHaveBeenCalledWith({ id: 'camp-1' });
    expect(campaigns.save).not.toHaveBeenCalled();
  });

  it('inativa campanha que já possui leads', async () => {
    const row = {
      id: 'camp-2',
      name: 'Com leads',
      active: true,
      status: 'active',
    } as MarketingCampaign;

    campaigns.findOne.mockResolvedValue(row);
    submissions.count.mockResolvedValue(3);
    campaigns.save.mockResolvedValue(row);

    const result = await service.deactivateCampaign('camp-2');

    expect(result).toEqual({ ok: true, removed: false });
    expect(row.active).toBe(false);
    expect(row.status).toBe('finished');
    expect(campaigns.save).toHaveBeenCalledWith(row);
    expect(campaigns.delete).not.toHaveBeenCalled();
  });

  it('lança 404 quando campanha não existe', async () => {
    campaigns.findOne.mockResolvedValue(null);
    await expect(service.deactivateCampaign('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
