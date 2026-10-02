export const TASK_STATUSES = ['PENDING', 'COMPLETED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_RECURRENCES = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];

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
  createdAt: Date;
  completedAt: Date | null;
}

/** Fila tal como la devuelven los stored procedures. */
export interface TaskRow {
  Id: number;
  Title: string;
  Description: string | null;
  Status: TaskStatus;
  Priority: TaskPriority;
  Category: string | null;
  DueDate: Date | string | null;
  Recurrence: TaskRecurrence;
  CreatedAt: Date;
  CompletedAt: Date | null;
}

export interface Attachment {
  id: number;
  taskId: number;
  originalName: string;
  size: number;
  mimeType: string | null;
  createdAt: Date;
}

export interface AttachmentFile extends Attachment {
  storedName: string;
}

export interface DueTask {
  id: number;
  title: string;
  description: string | null;
  priority: TaskPriority;
  category: string | null;
  /** YYYY-MM-DD */
  dueDate: string;
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

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export const STATS_GRANULARITIES = ['week', 'month', 'year'] as const;
export type StatsGranularity = (typeof STATS_GRANULARITIES)[number];

/** Unidad de agrupación de los buckets. 'day' se usa al analizar un periodo concreto. */
export const STATS_BUCKETS = ['day', 'week', 'month', 'year'] as const;
export type StatsBucketUnit = (typeof STATS_BUCKETS)[number];

/** Rango de fechas (YYYY-MM-DD) para acotar el análisis a un periodo. */
export interface StatsRange {
  from?: string;
  to?: string;
  bucket?: StatsBucketUnit;
}

export interface StatsTotals {
  total: number;
  pending: number;
  completed: number;
  /** 0–100 */
  completionRate: number;
  /** Horas promedio entre creación y culminación; null si no hay completadas. */
  avgCompletionHours: number | null;
}

export interface StatsBucket {
  /** Clave ISO del bucket (p. ej. 2026-09, 2026-W39, 2026). */
  bucket: string;
  /** Etiqueta legible en español. */
  label: string;
  created: number;
  completed: number;
}

export interface TaskStats {
  granularity: StatsGranularity;
  totals: StatsTotals;
  series: StatsBucket[];
}
