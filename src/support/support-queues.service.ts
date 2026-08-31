import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportQueue } from './support-queue.entity';
import {
  SUPPORT_TICKET_CATEGORIES,
  type SupportTicketCategory,
} from './support.types';

export type SupportQueueDto = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  sortOrder: number;
  active: boolean;
  isDefault: boolean;
  routeCategories: SupportTicketCategory[];
  createdAt: string;
  updatedAt: string;
};

export type SupportQueueCatalogItem = {
  value: string;
  label: string;
  description: string;
  color: string;
  isDefault?: boolean;
  routeCategories?: SupportTicketCategory[];
};

export type CreateSupportQueueInput = {
  slug?: string;
  name: string;
  description?: string | null;
  color?: string;
  sortOrder?: number;
  active?: boolean;
  isDefault?: boolean;
  routeCategories?: SupportTicketCategory[];
};

export type UpdateSupportQueueInput = Partial<CreateSupportQueueInput>;

const DEFAULT_QUEUES: Array<Omit<CreateSupportQueueInput, 'slug'> & { slug: string }> = [
  {
    slug: 'atendimento',
    name: 'Atendimento',
    description: 'Solicitações gerais, financeiras e operacionais.',
    color: '#059669',
    sortOrder: 1,
    isDefault: true,
    routeCategories: ['billing', 'feature', 'other'],
  },
  {
    slug: 'suporte',
    name: 'Suporte',
    description: 'Problemas técnicos, acesso e incidentes de plataforma.',
    color: '#7c3aed',
    sortOrder: 2,
    routeCategories: ['technical', 'access'],
  },
];

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function toDto(queue: SupportQueue): SupportQueueDto {
  return {
    id: queue.id,
    slug: queue.slug,
    name: queue.name,
    description: queue.description,
    color: queue.color,
    sortOrder: queue.sortOrder,
    active: queue.active,
    isDefault: queue.isDefault,
    routeCategories: Array.isArray(queue.routeCategories) ? queue.routeCategories : [],
    createdAt: queue.createdAt.toISOString(),
    updatedAt: queue.updatedAt.toISOString(),
  };
}

@Injectable()
export class SupportQueuesService implements OnModuleInit {
  constructor(
    @InjectRepository(SupportQueue)
    private readonly queues: Repository<SupportQueue>,
  ) {}

  async onModuleInit() {
    await this.ensureDefaults();
  }

  private async ensureDefaults() {
    for (const seed of DEFAULT_QUEUES) {
      const existing = await this.queues.findOne({ where: { slug: seed.slug } });
      if (existing) continue;
      await this.queues.save(
        this.queues.create({
          slug: seed.slug,
          name: seed.name,
          description: seed.description ?? null,
          color: seed.color ?? '#64748b',
          sortOrder: seed.sortOrder ?? 0,
          active: true,
          isDefault: Boolean(seed.isDefault),
          routeCategories: seed.routeCategories ?? [],
        }),
      );
    }

    const hasDefault = await this.queues.exist({ where: { isDefault: true, active: true } });
    if (!hasDefault) {
      const first = await this.queues.findOne({
        where: { active: true },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
      if (first) {
        first.isDefault = true;
        await this.queues.save(first);
      }
    }
  }

  async list(includeInactive = false): Promise<SupportQueueDto[]> {
    const rows = await this.queues.find({
      where: includeInactive ? undefined : { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map(toDto);
  }

  async listAll(): Promise<SupportQueueDto[]> {
    const rows = await this.queues.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
    return rows.map(toDto);
  }

  async listCatalog(): Promise<SupportQueueCatalogItem[]> {
    const rows = await this.list(true);
    return rows
      .filter((row) => row.active)
      .map((row) => ({
        value: row.slug,
        label: row.name,
        description: row.description ?? '',
        color: row.color,
        isDefault: row.isDefault,
        routeCategories: row.routeCategories ?? [],
      }));
  }

  async getById(id: string): Promise<SupportQueueDto> {
    const queue = await this.queues.findOne({ where: { id } });
    if (!queue) throw new NotFoundException('Fila não encontrada.');
    return toDto(queue);
  }

  async findBySlug(slug: string): Promise<SupportQueue | null> {
    return this.queues.findOne({ where: { slug } });
  }

  async assertActiveSlug(slug: string): Promise<SupportQueue> {
    const queue = await this.findBySlug(slug);
    if (!queue?.active) throw new BadRequestException('Fila inválida ou inativa.');
    return queue;
  }

  async resolveQueueSlug(
    category: SupportTicketCategory,
    explicitSlug?: string | null,
  ): Promise<string> {
    if (explicitSlug) {
      const queue = await this.assertActiveSlug(explicitSlug);
      return queue.slug;
    }

    const active = await this.queues.find({
      where: { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    const byCategory = active.find((row) =>
      (row.routeCategories ?? []).includes(category),
    );
    if (byCategory) return byCategory.slug;

    const fallback = active.find((row) => row.isDefault) ?? active[0];
    if (fallback) return fallback.slug;

    return 'atendimento';
  }

  async labelForSlug(slug: string): Promise<string> {
    const queue = await this.findBySlug(slug);
    return queue?.name ?? slug;
  }

  async listSlugsForStats(): Promise<string[]> {
    const ticketSlugs = await this.queues.manager
      .createQueryBuilder()
      .select('DISTINCT ticket.queue', 'slug')
      .from('acaf_support_tickets', 'ticket')
      .getRawMany<{ slug: string }>();

    const activeSlugs = (await this.list(true)).map((row) => row.slug);
    return [...new Set([...activeSlugs, ...ticketSlugs.map((row) => row.slug).filter(Boolean)])];
  }

  async create(input: CreateSupportQueueInput): Promise<SupportQueueDto> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Informe o nome da fila.');

    const slug = slugify(input.slug?.trim() || name);
    if (!slug) throw new BadRequestException('Slug inválido.');

    const exists = await this.queues.exist({ where: { slug } });
    if (exists) throw new BadRequestException('Já existe uma fila com este slug.');

    const routeCategories = this.normalizeCategories(input.routeCategories);
    const isDefault = Boolean(input.isDefault);

    if (isDefault) {
      await this.clearDefaultFlag();
    }

    const saved = await this.queues.save(
      this.queues.create({
        slug,
        name,
        description: input.description?.trim() || null,
        color: input.color?.trim() || '#64748b',
        sortOrder: input.sortOrder ?? 0,
        active: input.active !== false,
        isDefault,
        routeCategories,
      }),
    );

    return toDto(saved);
  }

  async update(id: string, input: UpdateSupportQueueInput): Promise<SupportQueueDto> {
    const queue = await this.queues.findOne({ where: { id } });
    if (!queue) throw new NotFoundException('Fila não encontrada.');

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('Informe o nome da fila.');
      queue.name = name;
    }

    if (input.slug !== undefined) {
      const slug = slugify(input.slug.trim());
      if (!slug) throw new BadRequestException('Slug inválido.');
      const duplicate = await this.queues.findOne({ where: { slug } });
      if (duplicate && duplicate.id !== queue.id) {
        throw new BadRequestException('Já existe uma fila com este slug.');
      }
      queue.slug = slug;
    }

    if (input.description !== undefined) {
      queue.description = input.description?.trim() || null;
    }

    if (input.color !== undefined) {
      queue.color = input.color?.trim() || '#64748b';
    }

    if (input.sortOrder !== undefined) {
      queue.sortOrder = Number(input.sortOrder) || 0;
    }

    if (input.active !== undefined) {
      queue.active = Boolean(input.active);
      if (!queue.active) queue.isDefault = false;
    }

    if (input.routeCategories !== undefined) {
      queue.routeCategories = this.normalizeCategories(input.routeCategories);
    }

    if (input.isDefault !== undefined) {
      if (input.isDefault) {
        await this.clearDefaultFlag(queue.id);
        queue.isDefault = true;
        queue.active = true;
      } else {
        queue.isDefault = false;
      }
    }

    if (queue.isDefault && !queue.active) {
      throw new BadRequestException('A fila padrão precisa permanecer ativa.');
    }

    const saved = await this.queues.save(queue);
    await this.ensureDefaultExists();
    return toDto(saved);
  }

  getCategoryOptions() {
    return SUPPORT_TICKET_CATEGORIES;
  }

  private normalizeCategories(values?: SupportTicketCategory[]): SupportTicketCategory[] {
    if (!values?.length) return [];
    const allowed = new Set(SUPPORT_TICKET_CATEGORIES.map((item) => item.value));
    return [...new Set(values.filter((value) => allowed.has(value)))];
  }

  private async clearDefaultFlag(exceptId?: string) {
    const rows = await this.queues.find({ where: { isDefault: true } });
    for (const row of rows) {
      if (exceptId && row.id === exceptId) continue;
      row.isDefault = false;
      await this.queues.save(row);
    }
  }

  private async ensureDefaultExists() {
    const hasDefault = await this.queues.exist({ where: { isDefault: true, active: true } });
    if (hasDefault) return;
    const first = await this.queues.findOne({
      where: { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    if (first) {
      first.isDefault = true;
      await this.queues.save(first);
    }
  }
}
