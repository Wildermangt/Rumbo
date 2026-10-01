export const TASK_STATUSES = ['PENDING', 'COMPLETED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskFilter = 'ALL' | TaskStatus;

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 — fecha de culminación; null mientras esté pendiente. */
  completedAt: string | null;
}

export interface CreateTaskPayload {
  title: string;
  description?: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type StatsGranularity = 'week' | 'month' | 'year';

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
