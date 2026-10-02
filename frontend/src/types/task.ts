export const TASK_STATUSES = ['PENDING', 'COMPLETED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskFilter = 'ALL' | TaskStatus;

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type PriorityFilter = 'ALL' | TaskPriority;

/** Etiquetas en español para cada prioridad. */
export const PRIORITY_LABELS: Record<TaskPriority, string> = { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta' };

/** Categorías sugeridas (también se puede escribir una libre). */
export const TASK_CATEGORIES = [
  'Trabajo',
  'Finanzas',
  'Clientes',
  'TI',
  'Administración',
  'Marketing',
  'Personal',
] as const;

export const TASK_RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];

/** Etiquetas en español para cada recurrencia. */
export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  NONE: 'No se repite',
  DAILY: 'Diaria',
  WEEKLY: 'Semanal',
  MONTHLY: 'Mensual',
};

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  category: string | null;
  /** YYYY-MM-DD o null */
  dueDate: string | null;
  recurrence: TaskRecurrence;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 — fecha de culminación; null mientras esté pendiente. */
  completedAt: string | null;
}

export interface CreateTaskPayload {
  title: string;
  description?: string | null;
  priority: TaskPriority;
  category?: string | null;
  dueDate?: string | null;
  recurrence: TaskRecurrence;
}

export interface Attachment {
  id: number;
  taskId: number;
  originalName: string;
  size: number;
  mimeType: string | null;
  createdAt: string;
}

export interface TaskNotification {
  id: number;
  title: string;
  priority: TaskPriority;
  category: string | null;
  dueDate: string | null;
  kind: 'OVERDUE' | 'DUE_SOON';
}

export interface Notifications {
  overdue: number;
  dueSoon: number;
  items: TaskNotification[];
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type StatsGranularity = 'week' | 'month' | 'year';
export type StatsBucketUnit = 'day' | 'week' | 'month' | 'year';

/** Periodo concreto a analizar (YYYY-MM-DD) y unidad de agrupación. */
export interface StatsRange {
  from?: string;
  to?: string;
  bucket?: StatsBucketUnit;
}

export interface StatsTotals {
  total: number;
  pending: number;
  completed: number;
  completionRate: number;
  avgCompletionHours: number | null;
}

export interface StatsBucket {
  bucket: string;
  label: string;
  created: number;
  completed: number;
}

export interface TaskStats {
  granularity: StatsGranularity;
  totals: StatsTotals;
  series: StatsBucket[];
}
