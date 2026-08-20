import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Modality } from './modality.entity';

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

@Injectable()
export class ModalitiesService {
  constructor(
    @InjectRepository(Modality)
    private readonly repo: Repository<Modality>,
  ) {}

  async findAll(): Promise<Modality[]> {
    return this.repo.find({ order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  async listActiveNames(): Promise<string[]> {
    const rows = await this.repo.find({
      where: { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map((row) => row.name);
  }

  private async findByIdOrThrow(id: string): Promise<Modality> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Modalidade não encontrada.');
    return row;
  }

  private async assertUniqueName(name: string, excludeId?: string): Promise<void> {
    const rows = await this.repo.find({ select: ['id', 'name'] });
    const key = name.toLowerCase();
    const clash = rows.find(
      (row) => row.id !== excludeId && row.name.toLowerCase() === key,
    );
    if (clash) {
      throw new ConflictException('Já existe uma modalidade com este nome.');
    }
  }

  async create(name: string): Promise<Modality> {
    const normalized = normalizeName(name);
    if (!normalized) {
      throw new BadRequestException('Informe o nome da modalidade.');
    }
    await this.assertUniqueName(normalized);

    const [last] = await this.repo.find({
      order: { sortOrder: 'DESC' },
      take: 1,
    });
    const sortOrder = (last?.sortOrder ?? -1) + 1;

    return this.repo.save(
      this.repo.create({ name: normalized, sortOrder, active: true }),
    );
  }

  async update(
    id: string,
    patch: { name?: string; sortOrder?: number; active?: boolean },
  ): Promise<Modality> {
    const row = await this.findByIdOrThrow(id);

    if (patch.name != null) {
      const normalized = normalizeName(patch.name);
      if (!normalized) {
        throw new BadRequestException('Informe o nome da modalidade.');
      }
      await this.assertUniqueName(normalized, id);
      row.name = normalized;
    }
    if (patch.sortOrder != null) {
      row.sortOrder = patch.sortOrder;
    }
    if (patch.active != null) {
      row.active = patch.active;
    }

    return this.repo.save(row);
  }

  async remove(id: string): Promise<void> {
    const row = await this.findByIdOrThrow(id);
    await this.repo.remove(row);
  }

  async reorder(ids: string[]): Promise<Modality[]> {
    if (!ids.length) {
      throw new BadRequestException('Informe a ordem das modalidades.');
    }

    const rows = await this.findAll();
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const id of ids) {
      if (!byId.has(id)) {
        throw new BadRequestException('Lista de ordenação contém ID inválido.');
      }
    }

    if (ids.length !== rows.length) {
      throw new BadRequestException('A ordenação deve incluir todas as modalidades.');
    }

    await this.repo.manager.transaction(async (manager) => {
      for (let index = 0; index < ids.length; index += 1) {
        await manager.update(Modality, { id: ids[index] }, { sortOrder: index });
      }
    });

    return this.findAll();
  }
}
