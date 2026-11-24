import type { ProjectTaskPhase, ProjectTaskPriority, ProjectTaskStatus } from './project-task.constants';

export type ProjectTaskDto = {
  id: string;
  code: string | null;
  phase: ProjectTaskPhase;
  name: string;
  startDate: string;
  endDate: string;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  tags: string[];
  estimatedHours: number;
  timeTrackedSeconds: number;
  requesterUserId: string | null;
  requesterName: string | null;
  progress: number;
  owner: string | null;
  ownerUserIds: string[];
  notes: string | null;
  isMilestone: boolean;
  sortOrder: number;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
  updatedAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
};

export type ProjectTaskEventDto = {
  id: string;
  taskId: string;
  userId: string | null;
  userName: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: string;
};

export type ProjectTaskCommentDto = {
  id: string;
  taskId: string;
  userId: string | null;
  userName: string | null;
  body: string;
  mentionedUserIds: string[];
  createdAt: string;
};

export type CreateProjectTaskBody = {
  code?: string | null;
  phase: ProjectTaskPhase;
  name: string;
  startDate: string;
  endDate: string;
  status?: ProjectTaskStatus;
  priority?: ProjectTaskPriority;
  tags?: string[] | null;
  estimatedHours?: number;
  timeTrackedSeconds?: number;
  requesterUserId?: string | null;
  progress?: number;
  owner?: string | null;
  ownerUserIds?: string[] | null;
  notes?: string | null;
  isMilestone?: boolean;
  sortOrder?: number;
};

export type PatchProjectTaskBody = Partial<CreateProjectTaskBody>;

export type CreateProjectTaskCommentBody = {
  body: string;
};

export type ProjectTaskAttachmentDto = {
  id: string;
  taskId: string;
  userId: string | null;
  userName: string | null;
  originalName: string;
  mimeType: string;
  size: number;
  publicUrl: string;
  createdAt: string;
};