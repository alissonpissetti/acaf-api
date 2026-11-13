import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PARTNER_LEGAL_SLUG_ONBOARDING } from './partner-legal.constants';
import { PartnerLegalDocument } from './partner-legal-document.entity';
import { PartnerLegalTermsService } from './partner-legal-terms.service';
import { PartnerTermsAcceptance } from './partner-terms-acceptance.entity';
import { UsersService } from '../users/users.service';

jest.mock('../partner/store', () => ({
  loadStore: () => ({
    units: [
      {
        id: 'unit-1',
        networkId: 'net-1',
        unitName: 'Unidade',
        neighborhood: 'Centro',
        city: 'SP',
        acafAssociate: {
          cnpj: '11222333000181',
          legalName: 'PARCEIRO LTDA',
          association: 'ACAF',
          signedAt: '2024-01-01',
          contactEmail: 'p@test.com',
          importSource: 'acaf_spreadsheet',
          importedAt: '2024-01-01',
        },
      },
    ],
    networks: [{ id: 'net-1', name: 'Rede' }],
  }),
  getDomain: () => ({ connectFeePercent: 20, dailyFeePercent: 20 }),
}));

const usersServiceMock = {
  findById: jest.fn().mockResolvedValue({
    id: 'user-1',
    name: 'Signatário Teste',
    email: 's@test.com',
    cpf: '52998224725',
    active: true,
  }),
  toSafeUser: jest.fn((u: { id: string; name: string; email: string; cpf: string | null }) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    cpf: u.cpf,
    active: true,
    roles: [],
    roleLabels: [],
  })),
};

function repoMock() {
  return {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn((row) => Promise.resolve({ ...row, id: row.id ?? 'doc-id' })),
    create: jest.fn((row) => row),
    count: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

describe('PartnerLegalTermsService', () => {
  let service: PartnerLegalTermsService;
  const documents = repoMock();
  const acceptances = repoMock();

  beforeEach(async () => {
    jest.clearAllMocks();
    documents.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ maxVersion: '1' }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PartnerLegalTermsService,
        { provide: getRepositoryToken(PartnerLegalDocument), useValue: documents },
        { provide: getRepositoryToken(PartnerTermsAcceptance), useValue: acceptances },
        { provide: UsersService, useValue: usersServiceMock },
      ],
    }).compile();

    service = module.get(PartnerLegalTermsService);
    jest.spyOn(service, 'onModuleInit').mockResolvedValue(undefined);
  });

  it('getPublishedPublic falha se não houver documento', async () => {
    documents.findOne.mockResolvedValue(null);
    await expect(service.getPublishedPublic(PARTNER_LEGAL_SLUG_ONBOARDING)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('publishNewVersion desativa anteriores e incrementa versão', async () => {
    documents.update.mockResolvedValue(undefined);
    documents.save.mockImplementation((row: PartnerLegalDocument) =>
      Promise.resolve({ ...row, id: 'new-doc', version: 2 }),
    );

    const result = await service.publishNewVersion({
      slug: PARTNER_LEGAL_SLUG_ONBOARDING,
      title: 'Termos v2',
      contentHtml: '<p>Novo</p>',
    });

    expect(documents.update).toHaveBeenCalledWith(
      { slug: PARTNER_LEGAL_SLUG_ONBOARDING, active: true },
      { active: false },
    );
    expect(result.version).toBe(2);
    expect(result.title).toBe('Termos v2');
  });

  it('acceptCurrentTerms registra aceite na versão vigente', async () => {
    const published: PartnerLegalDocument = {
      id: 'doc-1',
      slug: PARTNER_LEGAL_SLUG_ONBOARDING,
      title: 'Termos',
      contentHtml: '<p>OK</p>',
      version: 3,
      publishedAt: new Date('2026-01-01'),
      active: true,
      effectiveAt: new Date('2026-01-01'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    documents.findOne.mockResolvedValue(published);
    acceptances.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
      partnerUserId: 'user-1',
      networkId: 'net-1',
      documentId: 'doc-1',
      version: 3,
    });
    acceptances.save.mockResolvedValue({});

    const status = await service.acceptCurrentTerms(
      'user-1',
      ['unit-1'],
      PARTNER_LEGAL_SLUG_ONBOARDING,
      { signedName: 'Signatário Teste', signedDocument: '529.982.247-25' },
    );

    expect(acceptances.save).toHaveBeenCalledWith(
      expect.objectContaining({
        signedName: 'Signatário Teste',
        signedDocument: '52998224725',
        renderedHtmlSnapshot: '<p>OK</p>',
      }),
    );
    expect(status.accepted).toBe(true);
    expect(status.currentVersion).toBe(3);
  });

  it('renderOnboardingTermsForPartner personaliza HTML', async () => {
    const published: PartnerLegalDocument = {
      id: 'doc-1',
      slug: PARTNER_LEGAL_SLUG_ONBOARDING,
      title: 'Termos',
      contentHtml: '<p>Parceiro: {{partnerLegalName}}</p>',
      version: 1,
      publishedAt: new Date('2026-01-01'),
      active: true,
      effectiveAt: new Date('2026-01-01'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    documents.findOne.mockResolvedValue(published);

    const out = await service.renderOnboardingTermsForPartner('user-1', ['unit-1']);
    expect(out.contentHtml).toContain('PARCEIRO LTDA');
    expect(out.contentHtml).not.toContain('{{partnerLegalName}}');
  });

  it('acceptCurrentTerms exige CPF válido', async () => {
    const published: PartnerLegalDocument = {
      id: 'doc-1',
      slug: PARTNER_LEGAL_SLUG_ONBOARDING,
      title: 'Termos',
      contentHtml: '<p>OK</p>',
      version: 1,
      publishedAt: new Date('2026-01-01'),
      active: true,
      effectiveAt: new Date('2026-01-01'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    documents.findOne.mockResolvedValue(published);
    acceptances.findOne.mockResolvedValue(null);

    await expect(
      service.acceptCurrentTerms('user-1', ['unit-1'], PARTNER_LEGAL_SLUG_ONBOARDING, {
        signedName: 'Nome',
        signedDocument: '000.000.000-00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('publishNewVersion exige campos obrigatórios', async () => {
    await expect(
      service.publishNewVersion({
        slug: PARTNER_LEGAL_SLUG_ONBOARDING,
        title: '',
        contentHtml: '<p>x</p>',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('listDocumentTypes inclui o tipo nativo de termos de parceiro', async () => {
    documents.find.mockResolvedValue([]);
    const result = await service.listDocumentTypes();
    expect(result.types).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: PARTNER_LEGAL_SLUG_ONBOARDING,
          label: 'Termos de parceiro',
          builtIn: true,
          usedInOnboarding: true,
        }),
      ]),
    );
    expect(result.variables.length).toBeGreaterThan(0);
    expect(result.variables.some((row) => row.key === 'partnerLegalName')).toBe(true);
  });

  it('listDocumentTypes inclui slugs personalizados já publicados', async () => {
    documents.find.mockResolvedValue([
      {
        id: 'custom-1',
        slug: 'politica-privacidade',
        title: 'Política de privacidade',
        contentHtml: '<p>x</p>',
        version: 1,
        publishedAt: new Date('2026-01-01'),
        active: true,
        effectiveAt: new Date('2026-01-01'),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const result = await service.listDocumentTypes();
    expect(result.types.some((row) => row.slug === 'politica-privacidade')).toBe(true);
    expect(result.types.some((row) => row.slug === PARTNER_LEGAL_SLUG_ONBOARDING)).toBe(true);
  });

  it('createDocumentType rejeita identificador duplicado', async () => {
    documents.count.mockResolvedValue(1);
    await expect(
      service.createDocumentType({ slug: 'politica-privacidade', title: 'Política' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createDocumentType publica a primeira versão', async () => {
    documents.count.mockResolvedValue(0);
    documents.update.mockResolvedValue(undefined);
    documents.save.mockImplementation((row: PartnerLegalDocument) =>
      Promise.resolve({ ...row, id: 'custom-doc', version: 1 }),
    );
    const created = await service.createDocumentType({
      slug: 'declaracao-ciencia',
      title: 'Declaração de ciência',
      contentHtml: '<p>{{documentTitle}}</p>',
    });
    expect(created.slug).toBe('declaracao-ciencia');
    expect(created.title).toBe('Declaração de ciência');
    expect(created.version).toBe(1);
  });
});
