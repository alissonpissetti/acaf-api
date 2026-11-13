import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { loadStore } from '../partner/store';
import { UsersService } from '../users/users.service';
import { isValidCpf, normalizeCpf } from '../users/person.utils';
import { PARTNER_LEGAL_SLUG_ONBOARDING } from './partner-legal.constants';
import {
  DEFAULT_CUSTOM_DOCUMENT_HTML,
  DEFAULT_CUSTOM_DOCUMENT_TITLE,
  LEGAL_DOCUMENT_TYPES,
  RESERVED_DOCUMENT_SLUGS,
  findLegalDocumentType,
} from './partner-legal-document-types';
import { PartnerLegalDocument } from './partner-legal-document.entity';
import {
  buildPartnerOnboardingLegalContext,
  renderPartnerLegalTemplate,
} from './partner-legal-template';
import {
  DEFAULT_ONBOARDING_CONTRACT_HTML,
  DEFAULT_ONBOARDING_CONTRACT_TITLE,
  partnerLegalVariableCatalog,
  samplePartnerLegalVariables,
} from './partner-legal-template.variables';
import { PartnerTermsAcceptance } from './partner-terms-acceptance.entity';

export type PartnerLegalDocumentPublic = {
  id: string;
  slug: string;
  title: string;
  contentHtml: string;
  version: number;
  publishedAt: string;
  effectiveAt: string | null;
};

export type PartnerTermsAcceptanceStatus = {
  slug: string;
  required: boolean;
  accepted: boolean;
  currentVersion: number | null;
  acceptedVersion: number | null;
  documentId: string | null;
};

export type PartnerOnboardingTermsAcceptBody = {
  signedName: string;
  signedDocument: string;
  signatureImageBase64?: string | null;
};

export type AdminLegalDocumentType = {
  slug: string;
  label: string;
  description: string;
  builtIn: boolean;
  usedInOnboarding: boolean;
  title: string | null;
  version: number | null;
  publishedAt: string | null;
  active: boolean;
};

export type AdminLegalDocumentTypesResponse = {
  types: AdminLegalDocumentType[];
  variables: Array<{ key: string; hint: string }>;
};

const DOCUMENT_SLUG_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/;

const DEFAULT_ONBOARDING_TITLE = DEFAULT_ONBOARDING_CONTRACT_TITLE;
const DEFAULT_ONBOARDING_HTML = DEFAULT_ONBOARDING_CONTRACT_HTML;
const MAX_SIGNATURE_IMAGE_CHARS = 500_000;

function requestMeta(req?: Request): { ipAddress: string | null; userAgent: string | null } {
  if (!req) {
    return { ipAddress: null, userAgent: null };
  }
  const forwarded = req.headers['x-forwarded-for'];
  const ipRaw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ipAddress = (ipRaw?.split(',')[0]?.trim() || req.socket.remoteAddress || null) as string | null;
  const ua = req.headers['user-agent'];
  const userAgent = typeof ua === 'string' ? ua.slice(0, 512) : null;
  return { ipAddress, userAgent };
}

@Injectable()
export class PartnerLegalTermsService implements OnModuleInit {
  constructor(
    @InjectRepository(PartnerLegalDocument)
    private readonly documents: Repository<PartnerLegalDocument>,
    @InjectRepository(PartnerTermsAcceptance)
    private readonly acceptances: Repository<PartnerTermsAcceptance>,
    private readonly users: UsersService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSeedOnboardingDocument();
  }

  private async ensureSeedOnboardingDocument(): Promise<void> {
    const existing = await this.documents.findOne({
      where: { slug: PARTNER_LEGAL_SLUG_ONBOARDING, active: true },
    });
    if (existing?.publishedAt) return;

    const any = await this.documents.count({ where: { slug: PARTNER_LEGAL_SLUG_ONBOARDING } });
    if (any > 0) return;

    const now = new Date();
    await this.documents.save(
      this.documents.create({
        slug: PARTNER_LEGAL_SLUG_ONBOARDING,
        title: DEFAULT_ONBOARDING_TITLE,
        contentHtml: DEFAULT_ONBOARDING_HTML,
        version: 1,
        publishedAt: now,
        active: true,
        effectiveAt: now,
      }),
    );
  }

  private async nextVersionForSlug(slug: string): Promise<number> {
    const row = await this.documents
      .createQueryBuilder('d')
      .select('MAX(d.version)', 'maxVersion')
      .where('d.slug = :slug', { slug })
      .getRawOne<{ maxVersion: string | null }>();
    const current = row?.maxVersion != null ? Number(row.maxVersion) : 0;
    return current + 1;
  }

  async getPublishedDocument(slug: string): Promise<PartnerLegalDocument | null> {
    const trimmed = slug.trim();
    if (!trimmed) return null;
    return this.documents.findOne({
      where: { slug: trimmed, active: true },
      order: { version: 'DESC' },
    });
  }

  toPublic(doc: PartnerLegalDocument, contentHtml?: string): PartnerLegalDocumentPublic {
    if (!doc.publishedAt) {
      throw new BadRequestException('Documento não publicado.');
    }
    return {
      id: doc.id,
      slug: doc.slug,
      title: doc.title,
      contentHtml: contentHtml ?? doc.contentHtml,
      version: doc.version,
      publishedAt: doc.publishedAt.toISOString(),
      effectiveAt: doc.effectiveAt ? doc.effectiveAt.toISOString() : null,
    };
  }

  previewTemplateRender(contentHtml: string): { contentHtml: string } {
    const rendered = renderPartnerLegalTemplate(contentHtml.trim(), samplePartnerLegalVariables());
    return { contentHtml: rendered };
  }

  normalizeDocumentSlug(raw: string): string {
    const slug = raw.trim().toLowerCase();
    if (!DOCUMENT_SLUG_PATTERN.test(slug) || RESERVED_DOCUMENT_SLUGS.has(slug)) {
      throw new BadRequestException(
        'Identificador inválido. Use letras minúsculas, números, hífen ou sublinhado (2 a 64 caracteres).',
      );
    }
    return slug;
  }

  async listDocumentTypes(): Promise<AdminLegalDocumentTypesResponse> {
    const rows = await this.documents.find({
      order: { slug: 'ASC', version: 'DESC' },
    });
    const latestBySlug = new Map<string, PartnerLegalDocument>();
    for (const row of rows) {
      const existing = latestBySlug.get(row.slug);
      if (!existing) {
        latestBySlug.set(row.slug, row);
        continue;
      }
      if (row.active && !existing.active) {
        latestBySlug.set(row.slug, row);
        continue;
      }
      if (row.active === existing.active && row.version > existing.version) {
        latestBySlug.set(row.slug, row);
      }
    }

    const types: AdminLegalDocumentType[] = [];
    const seen = new Set<string>();
    for (const def of LEGAL_DOCUMENT_TYPES) {
      seen.add(def.slug);
      types.push(this.toAdminType(def.slug, latestBySlug.get(def.slug) ?? null));
    }
    for (const [slug, doc] of latestBySlug) {
      if (seen.has(slug)) continue;
      types.push(this.toAdminType(slug, doc));
    }

    return {
      types,
      variables: partnerLegalVariableCatalog(),
    };
  }

  async createDocumentType(body: {
    slug: string;
    title: string;
    contentHtml?: string;
  }): Promise<PartnerLegalDocument> {
    const slug = this.normalizeDocumentSlug(body.slug ?? '');
    const existing = await this.documents.count({ where: { slug } });
    if (existing > 0) {
      throw new BadRequestException('Já existe um documento com este identificador.');
    }
    const catalog = findLegalDocumentType(slug);
    const title = body.title?.trim() || catalog?.defaultTitle || DEFAULT_CUSTOM_DOCUMENT_TITLE;
    const contentHtml =
      body.contentHtml?.trim() || catalog?.defaultContentHtml || DEFAULT_CUSTOM_DOCUMENT_HTML;
    return this.publishNewVersion({ slug, title, contentHtml });
  }

  private toAdminType(slug: string, doc: PartnerLegalDocument | null): AdminLegalDocumentType {
    const catalog = findLegalDocumentType(slug);
    return {
      slug,
      label: catalog?.label || doc?.title?.trim() || slug,
      description: catalog?.description || 'Modelo personalizado do gerador de documentos.',
      builtIn: Boolean(catalog?.builtIn),
      usedInOnboarding: Boolean(catalog?.usedInOnboarding),
      title: doc?.title ?? catalog?.defaultTitle ?? null,
      version: doc?.version ?? null,
      publishedAt: doc?.publishedAt ? doc.publishedAt.toISOString() : null,
      active: Boolean(doc?.active),
    };
  }

  private async partnerUserForRender(partnerUserId: string) {
    const user = await this.users.findById(partnerUserId);
    if (!user) return null;
    const safe = this.users.toSafeUser(user);
    return { name: safe.name, email: safe.email, cpf: safe.cpf };
  }

  async renderOnboardingTermsForPartner(
    partnerUserId: string,
    unitIds: string[],
  ): Promise<PartnerLegalDocumentPublic> {
    const networkId = this.resolveNetworkIdFromUnitIds(unitIds);
    const published = await this.getPublishedDocument(PARTNER_LEGAL_SLUG_ONBOARDING);
    if (!published?.publishedAt) {
      throw new NotFoundException('Termos não encontrados ou ainda não publicados.');
    }
    const partnerUser = await this.partnerUserForRender(partnerUserId);
    const vars = buildPartnerOnboardingLegalContext({
      networkId,
      partnerUser,
      document: published,
    });
    const contentHtml = renderPartnerLegalTemplate(published.contentHtml, vars);
    return this.toPublic(published, contentHtml);
  }

  private validateSignatureBody(body: PartnerOnboardingTermsAcceptBody): {
    signedName: string;
    signedDocument: string;
    signatureImageBase64: string | null;
  } {
    const signedName = body.signedName?.trim() ?? '';
    const signedDocument = normalizeCpf(body.signedDocument ?? '');
    if (signedName.length < 3) {
      throw new BadRequestException('Informe o nome completo para assinatura.');
    }
    if (!isValidCpf(signedDocument)) {
      throw new BadRequestException('Informe um CPF válido para assinatura.');
    }
    let signatureImageBase64: string | null = null;
    const rawImage = body.signatureImageBase64?.trim();
    if (rawImage) {
      if (!rawImage.startsWith('data:image/') || rawImage.length > MAX_SIGNATURE_IMAGE_CHARS) {
        throw new BadRequestException('Assinatura manuscrita inválida.');
      }
      signatureImageBase64 = rawImage;
    }
    return { signedName, signedDocument, signatureImageBase64 };
  }

  async getPublishedPublic(slug: string): Promise<PartnerLegalDocumentPublic> {
    const doc = await this.getPublishedDocument(slug);
    if (!doc?.publishedAt) {
      throw new NotFoundException('Termos não encontrados ou ainda não publicados.');
    }
    return this.toPublic(doc);
  }

  resolveNetworkIdFromUnitIds(unitIds: string[]): string {
    const store = loadStore();
    for (const unitId of unitIds) {
      const unit = store.units.find((u) => u.id === unitId);
      if (unit?.networkId) return unit.networkId;
    }
    throw new BadRequestException('Não foi possível identificar a rede do parceiro.');
  }

  async getAcceptanceStatus(
    partnerUserId: string,
    networkId: string,
    slug: string,
  ): Promise<PartnerTermsAcceptanceStatus> {
    const published = await this.getPublishedDocument(slug);
    if (!published?.publishedAt) {
      return {
        slug,
        required: false,
        accepted: true,
        currentVersion: null,
        acceptedVersion: null,
        documentId: null,
      };
    }

    const acceptance = await this.acceptances.findOne({
      where: {
        partnerUserId,
        networkId: networkId.trim(),
        documentId: published.id,
      },
    });

    return {
      slug,
      required: true,
      accepted: Boolean(acceptance),
      currentVersion: published.version,
      acceptedVersion: acceptance?.version ?? null,
      documentId: published.id,
    };
  }

  async acceptCurrentTerms(
    partnerUserId: string,
    unitIds: string[],
    slug: string,
    body: PartnerOnboardingTermsAcceptBody,
    req?: Request,
  ): Promise<PartnerTermsAcceptanceStatus> {
    const networkId = this.resolveNetworkIdFromUnitIds(unitIds);
    const published = await this.getPublishedDocument(slug);
    if (!published?.publishedAt) {
      throw new BadRequestException('Não há termos publicados para aceite.');
    }

    const existing = await this.acceptances.findOne({
      where: { partnerUserId, networkId, documentId: published.id },
    });
    if (existing) {
      return this.getAcceptanceStatus(partnerUserId, networkId, slug);
    }

    const signature = this.validateSignatureBody(body);
    const acceptedAt = new Date();
    const partnerUser = await this.partnerUserForRender(partnerUserId);
    const vars = buildPartnerOnboardingLegalContext({
      networkId,
      partnerUser,
      document: published,
      signature: {
        signedName: signature.signedName,
        signedDocument: signature.signedDocument,
        signedAt: acceptedAt,
      },
    });
    let renderedHtmlSnapshot = renderPartnerLegalTemplate(published.contentHtml, vars);
    if (signature.signatureImageBase64) {
      renderedHtmlSnapshot += `<p class="partner-signature-image"><img src="${signature.signatureImageBase64}" alt="Assinatura" style="max-width:280px;height:auto" /></p>`;
    }

    const { ipAddress, userAgent } = requestMeta(req);
    await this.acceptances.save(
      this.acceptances.create({
        partnerUserId,
        networkId,
        slug: published.slug,
        documentId: published.id,
        version: published.version,
        ipAddress,
        userAgent,
        signedName: signature.signedName,
        signedDocument: signature.signedDocument,
        signatureImageBase64: signature.signatureImageBase64,
        renderedHtmlSnapshot,
      }),
    );

    return this.getAcceptanceStatus(partnerUserId, networkId, slug);
  }

  async listVersions(slug: string): Promise<PartnerLegalDocument[]> {
    return this.documents.find({
      where: { slug: slug.trim() },
      order: { version: 'DESC' },
    });
  }

  async getDocumentById(id: string): Promise<PartnerLegalDocument> {
    const doc = await this.documents.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    return doc;
  }

  async publishNewVersion(body: {
    slug: string;
    title: string;
    contentHtml: string;
    effectiveAt?: string | null;
  }): Promise<PartnerLegalDocument> {
    const slug = this.normalizeDocumentSlug(body.slug ?? '');
    const title = body.title?.trim();
    const contentHtml = body.contentHtml?.trim();
    if (!title || !contentHtml) {
      throw new BadRequestException('Informe slug, título e conteúdo.');
    }

    const version = await this.nextVersionForSlug(slug);
    const now = new Date();
    let effectiveAt: Date | null = null;
    if (body.effectiveAt) {
      const parsed = new Date(body.effectiveAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Data de vigência inválida.');
      }
      effectiveAt = parsed;
    }

    await this.documents.update({ slug, active: true }, { active: false });

    return this.documents.save(
      this.documents.create({
        slug,
        title,
        contentHtml,
        version,
        publishedAt: now,
        active: true,
        effectiveAt: effectiveAt ?? now,
      }),
    );
  }
}
