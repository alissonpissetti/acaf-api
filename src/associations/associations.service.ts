import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Association } from './association.entity';
import { associationPartnersPermissionKey } from './association-permissions';
import { Permission } from '../access-control/permission.entity';

const ACAF_DEFAULT = {
  slug: 'acaf',
  name: 'ACAF',
  description: 'Associação comercial ACAF (portal parceiros movly.).',
  sortOrder: 1,
};

function normalizeSlug(input: string): string {
  const slug = input.trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,48}$/.test(slug)) {
    throw new BadRequestException(
      'Slug inválido: use letras minúsculas, números e hífens (ex.: acaf, foo-bar).',
    );
  }
  return slug;
}

export type AssociationDto = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  portalPublicUrl: string | null;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  /** Chave de permissão do portal: `associacao.{slug}.parceiros` */
  partnersPermissionKey: string;
};

@Injectable()
export class AssociationsService implements OnModuleInit {
  constructor(
    @InjectRepository(Association)
    private readonly associations: Repository<Association>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
  ) {}

  async onModuleInit() {
    await this.ensureAcafAssociation();
  }

  async ensureAcafAssociation(): Promise<Association> {
    let row = await this.associations.findOne({ where: { slug: ACAF_DEFAULT.slug } });
    if (!row) {
      row = await this.associations.save(
        this.associations.create({
          ...ACAF_DEFAULT,
          portalPublicUrl: null,
          active: true,
        }),
      );
      await this.ensurePartnersPermission(row.slug, row.name);
    }
    return row;
  }

  private toDto(row: Association): AssociationDto {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      portalPublicUrl: row.portalPublicUrl,
      active: row.active,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt.toISOString(),
      partnersPermissionKey: associationPartnersPermissionKey(row.slug),
    };
  }

  async listAdmin(): Promise<AssociationDto[]> {
    const rows = await this.associations.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
    return rows.map((row) => this.toDto(row));
  }

  async getBySlug(slug: string): Promise<Association | null> {
    return this.associations.findOne({ where: { slug: normalizeSlug(slug) } });
  }

  async requireBySlug(slug: string): Promise<Association> {
    const row = await this.getBySlug(slug);
    if (!row) throw new NotFoundException('Associação não encontrada.');
    if (!row.active) throw new NotFoundException('Associação inativa.');
    return row;
  }

  async getById(id: string): Promise<Association | null> {
    return this.associations.findOne({ where: { id } });
  }

  async create(input: {
    slug: string;
    name: string;
    description?: string;
    portalPublicUrl?: string;
    sortOrder?: number;
    active?: boolean;
  }): Promise<AssociationDto> {
    const slug = normalizeSlug(input.slug);
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Informe o nome da associação.');

    const existing = await this.associations.findOne({ where: { slug } });
    if (existing) throw new BadRequestException('Já existe uma associação com este slug.');

    const row = await this.associations.save(
      this.associations.create({
        slug,
        name,
        description: input.description?.trim() || null,
        portalPublicUrl: input.portalPublicUrl?.trim() || null,
        sortOrder: input.sortOrder ?? 0,
        active: input.active ?? true,
      }),
    );

    await this.ensurePartnersPermission(row.slug, row.name);
    return this.toDto(row);
  }

  async update(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      portalPublicUrl?: string | null;
      sortOrder?: number;
      active?: boolean;
    },
  ): Promise<AssociationDto> {
    const row = await this.associations.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Associação não encontrada.');

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new BadRequestException('Nome não pode ser vazio.');
      row.name = name;
    }
    if (patch.description !== undefined) {
      row.description = patch.description?.trim() || null;
    }
    if (patch.portalPublicUrl !== undefined) {
      row.portalPublicUrl = patch.portalPublicUrl?.trim() || null;
    }
    if (patch.sortOrder !== undefined) row.sortOrder = patch.sortOrder;
    if (patch.active !== undefined) row.active = patch.active;

    const saved = await this.associations.save(row);
    return this.toDto(saved);
  }

  /**
   * Garante permissão `associacao.{slug}.parceiros` (sem item de menu — portal é app separado ou link externo).
   */
  async ensurePartnersPermission(slug: string, labelHint?: string): Promise<void> {
    const key = associationPartnersPermissionKey(slug);
    let permission = await this.permissions.findOne({ where: { key } });
    if (!permission) {
      permission = this.permissions.create({
        key,
        label: `Ver portal parceiros ${labelHint?.trim() || slug}`,
        moduleItemId: null,
      });
      await this.permissions.save(permission);
    }
  }
}
