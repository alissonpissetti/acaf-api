import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import {
  CommercialLeadAuditChange,
  CommercialLeadAuditLog,
} from './commercial-lead-audit.entity';

@Injectable()
export class CommercialLeadAuditService {
  constructor(
    @InjectRepository(CommercialLeadAuditLog)
    private readonly logs: Repository<CommercialLeadAuditLog>,
    private readonly users: UsersService,
  ) {}

  async listForLead(leadId: string) {
    const rows = await this.logs.find({
      where: { leadId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return Promise.all(
      rows.map(async (row) => {
        const user = row.userId ? await this.users.findById(row.userId) : null;
        return {
          id: row.id,
          leadId: row.leadId,
          userId: row.userId,
          userName: user?.name ?? (row.userId ? null : 'Sistema'),
          summary: row.summary,
          changes: row.changes,
          createdAt: row.createdAt.toISOString(),
        };
      }),
    );
  }

  async deleteForLeads(leadIds: string[]) {
    const ids = leadIds.filter(Boolean);
    if (!ids.length) return;
    await this.logs.delete({ leadId: In(ids) });
  }

  async record(leadId: string, userId: string | undefined, changes: CommercialLeadAuditChange[]) {
    const filtered = changes.filter((item) => item.from !== item.to);
    if (!filtered.length) return;

    const summary =
      filtered.length === 1
        ? filtered[0].label
        : `${filtered.length} alterações: ${filtered.map((c) => c.label).join(', ')}`;

    await this.logs.save(
      this.logs.create({
        leadId,
        userId: userId?.trim() || null,
        summary: summary.slice(0, 500),
        changes: filtered.map((item) => ({
          field: item.field,
          label: item.label,
          from: item.from,
          to: item.to,
        })),
      }),
    );
  }
}
