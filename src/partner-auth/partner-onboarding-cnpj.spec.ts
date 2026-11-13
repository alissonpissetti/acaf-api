import { findNetworkIdForCnpj } from './partner-onboarding-cnpj';
import type { AdminNetwork, ApiStore, GymUnit } from '../partner/types';

function emptyStore(overrides: Partial<ApiStore> = {}): ApiStore {
  return {
    networkId: '',
    networkName: '',
    networks: [],
    activeUnitId: '',
    units: [],
    students: [],
    payoutsByUnit: {},
    payoutHistoryByUnit: {},
    issuedCodes: [],
    checkInLog: [],
    pendingCheckIns: [],
    ...overrides,
  };
}

describe('findNetworkIdForCnpj', () => {
  const network: AdminNetwork = { id: 'net_1', name: 'Academia Norte', cnpj: null };
  const unit = {
    id: 'g_1',
    networkId: 'net_1',
    unitName: 'Unidade Centro',
    neighborhood: '',
    city: '',
    openHours: '',
    description: '',
    modalities: [],
    dailyPassPrice: 0,
    dailyPassActive: false,
    dailyPassNotes: '',
    dailyPassModalities: [],
    planSpecs: [],
    heroPhotoDataUrl: null,
    galleryPhotoDataUrls: [],
    acafAssociate: {
      cnpj: '11222333000181',
      legalName: 'ACME LTDA',
      association: '',
      signedAt: '2026-01-01',
      contactEmail: 'resp@acme.test',
      importSource: 'acaf_associates_xlsx',
      importedAt: '2026-01-01',
    },
  } as GymUnit;

  it('localiza a rede pelo CNPJ da unidade (com máscara)', () => {
    const store = emptyStore({ networks: [network], units: [unit] });
    expect(findNetworkIdForCnpj(store, '11.222.333/0001-81')).toBe('net_1');
  });

  it('localiza pelo CNPJ legado da rede quando a unidade não tem metadado', () => {
    const store = emptyStore({
      networks: [{ ...network, cnpj: '11222333000181' }],
      units: [{ ...unit, acafAssociate: undefined }],
    });
    expect(findNetworkIdForCnpj(store, '11222333000181')).toBe('net_1');
  });

  it('não inventa rede para CNPJ desconhecido', () => {
    const store = emptyStore({ networks: [network], units: [unit] });
    expect(findNetworkIdForCnpj(store, '34028316000103')).toBeNull();
  });
});
