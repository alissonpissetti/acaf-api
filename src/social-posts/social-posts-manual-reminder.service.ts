import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { User } from '../users/user.entity';
import { SOCIAL_CALENDAR_TZ } from './social-post.constants';
import { SocialPost } from './social-post.entity';
import { requiresManualPosting } from './social-post.rules';

const LEAD_MS = 15 * 60 * 1000;
const WINDOW_MS = 2 * 60 * 1000;

@Injectable()
export class SocialPostsManualReminderService {
  private readonly logger = new Logger(SocialPostsManualReminderService.name);

  constructor(
    @InjectRepository(SocialPost)
    private readonly posts: Repository<SocialPost>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly config: ConfigService,
  ) {}

  async processDueReminders(): Promise<{ sent: number; skipped: number; errors: string[] }> {
    const now = Date.now();
    const rows = await this.posts.find({
      where: {
        agendadoPara: Not(IsNull()),
        responsavelUserId: Not(IsNull()),
        manualReminderSentAt: IsNull(),
        etapa: In(['rascunho', 'programado']),
      },
      relations: ['artes'],
    });

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const post of rows) {
      if (post.aprovacao !== 'aprovado') {
        skipped++;
        continue;
      }
      if (!post.agendadoPara || !post.responsavelUserId) {
        skipped++;
        continue;
      }
      if (!requiresManualPosting(post.envio, post.artes ?? [])) {
        skipped++;
        continue;
      }

      const target = post.agendadoPara.getTime() - LEAD_MS;
      if (now < target || now >= target + WINDOW_MS) {
        skipped++;
        continue;
      }

      const user = await this.users.findOne({ where: { id: post.responsavelUserId, active: true } });
      if (!user) {
        errors.push(`${post.codigo}: responsável inválido ou inativo.`);
        skipped++;
        continue;
      }

      try {
        const ok = await this.notifyResponsavel(post, user);
        if (ok) {
          post.manualReminderSentAt = new Date();
          await this.posts.save(post);
          sent++;
        } else {
          errors.push(`${post.codigo}: nenhum canal (SMS/e-mail) enviou o lembrete.`);
        }
      } catch (e) {
        errors.push(`${post.codigo}: ${e instanceof Error ? e.message : 'falha no lembrete'}`);
      }
    }

    return { sent, skipped, errors };
  }

  private formatWhen(d: Date): string {
    return d.toLocaleString('pt-BR', {
      timeZone: SOCIAL_CALENDAR_TZ,
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private adminCalendarUrl(): string {
    const base =
      this.config.get<string>('ADMIN_PUBLIC_URL')?.replace(/\/$/, '') ||
      this.config.get<string>('APP_PUBLIC_URL')?.replace(/\/$/, '') ||
      'http://localhost:5173';
    return `${base}/m/marketing/redes-sociais`;
  }

  private async notifyResponsavel(post: SocialPost, user: User): Promise<boolean> {
    const when = this.formatWhen(post.agendadoPara!);
    const title = post.titulo.trim();
    const cal = this.adminCalendarUrl();
    const smsText = `Movly redes: em 15 min (${when}) publique manualmente "${title}" (${post.codigo}). Calendário: ${cal}`;

    const subject = `Lembrete — publicação manual em 15 min · ${post.codigo}`;
    const text = [
      `Olá, ${user.name},`,
      '',
      `Daqui a 15 minutos (${when}) você deve publicar manualmente no app/Meta Business Suite:`,
      '',
      `• ${title} (${post.codigo})`,
      `• Tipo: ${post.envio}`,
      post.aviso ? `• Aviso: ${post.aviso}` : null,
      '',
      'O post tem figurinha de link ou interação — não vai pelo Buffer sozinho.',
      '',
      `Abrir calendário: ${cal}`,
    ]
      .filter(Boolean)
      .join('\n');

    const html = `<p>Olá, <strong>${user.name}</strong>,</p>
<p>Daqui a <strong>15 minutos</strong> (${when}) publique manualmente no app / Meta Business Suite:</p>
<ul><li><strong>${title}</strong> (${post.codigo})</li><li>${post.envio}</li></ul>
${post.aviso ? `<p><em>${post.aviso}</em></p>` : ''}
<p>O post tem figurinha de link ou interação — não vai só pelo Buffer.</p>
<p><a href="${cal}">Abrir Calendário Social</a></p>`;

    let any = false;

    if (user.email?.trim()) {
      const mail = await this.mail.sendSocialManualPostReminder({ to: user.email, subject, text, html });
      if (mail.sent) any = true;
    }

    if (user.mobilePhone?.trim()) {
      const sms = await this.sms.sendSocialManualPostReminder({ to: user.mobilePhone, message: smsText });
      if (sms.sent) any = true;
    }

    return any;
  }
}