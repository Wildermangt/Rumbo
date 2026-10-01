export const TASK_STATUSES = ['PENDING', 'COMPLETED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  createdAt: Date;
  completedAt: Date | null;
}

/** Fila tal como la devuelven los stored procedures. */
export interface TaskRow {
  Id: number;
  Title: string;
  Description: string | null;
  Status: TaskStatus;
  CreatedAt: Date;
  CompletedAt: Date | null;
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
