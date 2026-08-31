/**
 * Registro de handlers reativos a eventos de domínio.
 *
 * Para adicionar um novo gatilho:
 * 1. Inclua a definição em NOTIFICATION_TRIGGER_CATALOG (notification.types.ts)
 * 2. Implemente um handler neste arquivo
 * 3. Registre o handler em onModuleInit() abaixo
 *
 * Handlers podem chamar NotificationsService.notify() com os destinatários resolvidos.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { NotificationTriggersRegistry } from './notification-triggers.registry';

@Injectable()
export class NotificationTriggerHandlers implements OnModuleInit {
  constructor(private readonly triggers: NotificationTriggersRegistry) {}

  onModuleInit(): void {
    // Chamados de atendimento disparam notificações via SupportNotificationsService
    // (support.ticket.*), usando NotificationsService.notify() diretamente.
  }
}
