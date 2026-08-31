export type SupportTicketSource = 'admin' | 'partner' | 'corporate' | 'app';

/** Slug da fila configurável em acaf_support_queues */
export type SupportTicketQueue = string;

export type SupportQueueCatalogItem = {
  value: string;
  label: string;
  description: string;
  color: string;
  isDefault?: boolean;
  routeCategories?: SupportTicketCategory[];
};

export type SupportTicketStatus =
  | 'open'
  | 'in_progress'
  | 'waiting_requester'
  | 'resolved'
  | 'closed';

export type SupportTicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export type SupportTicketCategory =
  | 'technical'
  | 'access'
  | 'billing'
  | 'feature'
  | 'other';

export const SUPPORT_TICKET_CATEGORIES: Array<{
  value: SupportTicketCategory;
  label: string;
}> = [
  { value: 'technical', label: 'Problema técnico' },
  { value: 'access', label: 'Acesso e permissões' },
  { value: 'billing', label: 'Financeiro e cobrança' },
  { value: 'feature', label: 'Dúvida ou funcionalidade' },
  { value: 'other', label: 'Outros' },
];

export const SUPPORT_TICKET_PRIORITIES: Array<{
  value: SupportTicketPriority;
  label: string;
}> = [
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

export const SUPPORT_TICKET_STATUSES: Array<{
  value: SupportTicketStatus;
  label: string;
}> = [
  { value: 'open', label: 'Aberto' },
  { value: 'in_progress', label: 'Em atendimento' },
  { value: 'waiting_requester', label: 'Aguardando solicitante' },
  { value: 'resolved', label: 'Resolvido' },
  { value: 'closed', label: 'Encerrado' },
];

export const SUPPORT_TICKET_SOURCES: Array<{
  value: SupportTicketSource;
  label: string;
}> = [
  { value: 'admin', label: 'Admin' },
  { value: 'partner', label: 'Parceiro' },
  { value: 'corporate', label: 'Corporativo' },
  { value: 'app', label: 'App' },
];

export type CreateSupportTicketInput = {
  subject: string;
  description: string;
  category: SupportTicketCategory;
  queue?: SupportTicketQueue;
  priority?: SupportTicketPriority;
  contextUrl?: string | null;
  contextLabel?: string | null;
  contextMetadata?: Record<string, unknown> | null;
  companyId?: string | null;
  unitId?: string | null;
};

export type UpdateSupportTicketInput = {
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
  queue?: SupportTicketQueue;
  assignedToUserId?: string | null;
};

export type CreateSupportTicketMessageInput = {
  body: string;
  isInternal?: boolean;
};

export type SupportTicketListQuery = {
  mineOnly?: boolean;
  queue?: SupportTicketQueue;
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
  source?: SupportTicketSource;
  assignedToMe?: boolean;
  openOnly?: boolean;
  q?: string;
  sort?: 'updatedAt' | 'createdAt' | 'priority';
  limit?: number;
  offset?: number;
};

export type SupportQueueBucketStats = {
  total: number;
  open: number;
  inProgress: number;
  waitingRequester: number;
  urgent: number;
};

export type SupportQueueStatsDto = {
  total: number;
  open: number;
  inProgress: number;
  waitingRequester: number;
  urgent: number;
  assignedToMe: number;
  byQueue: Record<string, SupportQueueBucketStats>;
};

export type SupportTicketDto = {
  id: string;
  code: string;
  source: SupportTicketSource;
  subject: string;
  description: string;
  category: SupportTicketCategory;
  categoryLabel: string;
  queue: SupportTicketQueue;
  queueLabel: string;
  queueColor: string;
  priority: SupportTicketPriority;
  priorityLabel: string;
  status: SupportTicketStatus;
  statusLabel: string;
  requesterUserId: string;
  requesterName: string;
  requesterEmail: string;
  companyId: string | null;
  unitId: string | null;
  contextUrl: string | null;
  contextLabel: string | null;
  contextMetadata: Record<string, unknown> | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  messageCount: number;
};

export type SupportTicketMessageDto = {
  id: string;
  ticketId: string;
  authorUserId: string;
  authorName: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
};

export type SupportTicketDetailDto = SupportTicketDto & {
  messages: SupportTicketMessageDto[];
};
