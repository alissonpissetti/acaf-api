export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export type NotificationChannel = 'in_app' | 'email' | 'push';

export type NotificationTriggerDefinition = {
  key: string;
  label: string;
  description: string;
  category: string;
  channels: NotificationChannel[];
  enabled: boolean;
};

/**
 * Catálogo de gatilhos conhecidos pela plataforma.
 * Novos processos devem registrar aqui antes de chamar NotificationsService.notify().
 */
export const NOTIFICATION_TRIGGER_CATALOG: NotificationTriggerDefinition[] = [
  {
    key: 'support.ticket.created',
    label: 'Chamado aberto',
    description: 'Novo chamado de atendimento registrado por um solicitante.',
    category: 'Atendimento',
    channels: ['in_app'],
    enabled: true,
  },
  {
    key: 'support.ticket.message',
    label: 'Nova mensagem no chamado',
    description: 'Resposta ou interação pública em um chamado existente.',
    category: 'Atendimento',
    channels: ['in_app'],
    enabled: true,
  },
  {
    key: 'support.ticket.internal_note',
    label: 'Nota interna no chamado',
    description: 'Registro interno da equipe de atendimento (visível apenas no admin).',
    category: 'Atendimento',
    channels: ['in_app'],
    enabled: true,
  },
  {
    key: 'support.ticket.assigned',
    label: 'Chamado atribuído',
    description: 'Um chamado foi atribuído a um responsável da equipe.',
    category: 'Atendimento',
    channels: ['in_app'],
    enabled: true,
  },
  {
    key: 'support.ticket.status',
    label: 'Status do chamado alterado',
    description: 'Mudança de status relevante para solicitante ou equipe.',
    category: 'Atendimento',
    channels: ['in_app'],
    enabled: true,
  },
];

export type NotifyUsersInput = {
  userIds: string[];
  triggerKey: string;
  title: string;
  body: string;
  severity?: NotificationSeverity;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type NotificationTriggerEvent = {
  triggerKey: string;
  payload: Record<string, unknown>;
};

export type NotificationListQuery = {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
};

export type NotificationDto = {
  id: string;
  userId: string;
  triggerKey: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationSummaryDto = {
  unreadCount: number;
  items: NotificationDto[];
};
