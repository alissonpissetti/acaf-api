import { Test, TestingModule } from '@nestjs/testing';
import { ModalitiesService } from '../modalities/modalities.service';
import { PartnerService } from './partner.service';

describe('PartnerService', () => {
  let service: PartnerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerService,
        {
          provide: ModalitiesService,
          useValue: {
            listActiveNames: async () => ['Musculação'],
          },
        },
      ],
    }).compile();

    service = module.get<PartnerService>(PartnerService);
  });

  it('returns health payload', () => {
    expect(service.getHealth()).toEqual({ status: 'ok', service: 'acaf-api' });
  });

  it('returns bootstrap with demo network', () => {
    const boot = service.getBootstrap();
    expect(boot.networkName).toBeTruthy();
    expect(boot.units.length).toBeGreaterThan(0);
  });
});
