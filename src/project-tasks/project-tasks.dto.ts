import type { ProjectTaskPhase, ProjectTaskStatus } from './project-task.constants';

export type ProjectTaskDto = {
  id: string;
  code: string | null;
  phase: ProjectTaskPhase;
  name: string;
  startDate: string;
  endDate: string;
  status: ProjectTaskStatus;
  progress: number;
  owner: string | null;
  ownerUserIds: string[];
  notes: string | null;
  isMilestone: boolean;
  sortOrder: number;
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

export type CreateProjectTaskBody = {
  code?: string | null;
  phase: ProjectTaskPhase;
  name: string;
  startDate: string;
  endDate: string;
  status?: ProjectTaskStatus;
  progress?: number;
  owner?: string | null;
  ownerUserIds?: string[] | null;
  notes?: string | null;
  isMilestone?: boolean;
  sortOrder?: number;
};

export type PatchProjectTaskBody = Partial<CreateProjectTaskBody>;