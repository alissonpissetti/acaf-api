import { Test, TestingModule } from '@nestjs/testing';
import { CorporateAccessService } from '../corporate/corporate-access.service';
import { ModalitiesService } from '../modalities/modalities.service';
import { AdminService } from './admin.service';
import { PartnerService } from './partner.service';
import { createEmptyStore } from './store-normalize';
import { registerStoreBackend } from './store';
import { UnitCoordinatesService } from './unit-coordinates.service';
import { UnitScheduleService } from './unit-schedule.service';

describe('PartnerService', () => {
  let service: PartnerService;

  beforeEach(async () => {
    const empty = createEmptyStore();
    registerStoreBackend({
      isReady: () => true,
      getStore: () => empty,
      setStore: () => {},
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerService,
        {
          provide: ModalitiesService,
          useValue: {
            listActiveNames: async () => ['Musculação'],
          },
        },
        {
          provide: UnitScheduleService,
          useValue: {},
        },
        {
          provide: UnitCoordinatesService,
          useValue: {},
        },
        {
          provide: CorporateAccessService,
          useValue: {
            findActiveByEnrollmentCode: async () => null,
          },
        },
        {
          provide: AdminService,
          useValue: {
            getNetworkForPartner: () => ({}),
            updateNetworkForPartner: () => ({}),
            uploadNetworkLogoForPartner: async () => ({}),
          },
        },
      ],
    }).compile();

    service = module.get<PartnerService>(PartnerService);
  });

  it('returns health payload', () => {
    expect(service.getHealth()).toEqual({ status: 'ok', service: 'connect-api' });
  });

  it('returns bootstrap from persisted store', () => {
    const boot = service.getBootstrap();
    expect(boot).toMatchObject({ units: [] });
    expect(typeof boot.networkId).toBe('string');
    expect(typeof boot.networkName).toBe('string');
  });
});
