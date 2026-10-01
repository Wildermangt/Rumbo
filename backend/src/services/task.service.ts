import type { RawBucket, TaskRepository } from '../repositories/task.repository';
import type { CreateTaskDto, ListTasksQuery } from '../schemas/task.schema';
import type { PaginatedResult, StatsBucket, StatsGranularity, Task, TaskStats, TaskStatus } from '../types/task';

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Nº de buckets recientes a mostrar por granularidad. */
const WINDOW: Record<StatsGranularity, number> = { week: 12, month: 12, year: 6 };

/** Normaliza una fecha al inicio de su bucket (UTC) según la granularidad. */
function startOfBucket(date: Date, g: StatsGranularity): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (g === 'year') return new Date(Date.UTC(y, 0, 1));
  if (g === 'month') return new Date(Date.UTC(y, m, 1));
  // week: lunes de la semana
  const dow = (date.getUTCDay() + 6) % 7; // lunes = 0
  return new Date(Date.UTC(y, m, date.getUTCDate() - dow));
}

function nextBucket(date: Date, g: StatsGranularity): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  if (g === 'year') return new Date(Date.UTC(y + 1, 0, 1));
  if (g === 'month') return new Date(Date.UTC(y, m + 1, 1));
  return new Date(Date.UTC(y, m, d + 7));
}

function bucketKey(date: Date, g: StatsGranularity): string {
  const y = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  if (g === 'year') return `${y}`;
  if (g === 'month') return `${y}-${mm}`;
  return `${y}-${mm}-${dd}`;
}

function bucketLabel(date: Date, g: StatsGranularity): string {
  const y = date.getUTCFullYear();
  const mon = MONTHS_ES[date.getUTCMonth()];
  if (g === 'year') return `${y}`;
  if (g === 'month') return `${mon} ${y}`;
  return `${date.getUTCDate()} ${mon}`;
}

export class TaskService {
  constructor(private readonly repository: TaskRepository) {}

  async list(query: ListTasksQuery): Promise<PaginatedResult<Task>> {
    const { items, total } = await this.repository.findPaginated({
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
      search: query.search,
      sort: query.sort,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    });

    return {
      items,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  create(dto: CreateTaskDto): Promise<Task> {
    return this.repository.create({ title: dto.title, description: dto.description });
  }

  updateStatus(id: number, status: TaskStatus): Promise<Task> {
    return this.repository.updateStatus(id, status);
  }

  async getStats(granularity: StatsGranularity): Promise<TaskStats> {
    const raw = await this.repository.getStats(granularity);

    const index = (rows: RawBucket[]): Map<string, number> => {
      const map = new Map<string, number>();
      for (const r of rows) map.set(bucketKey(startOfBucket(r.bucket, granularity), granularity), r.count);
      return map;
    };
    const createdMap = index(raw.created);
    const completedMap = index(raw.completed);

    // Rango: desde el bucket más antiguo con datos, acotado a una ventana reciente.
    const now = startOfBucket(new Date(), granularity);
    let windowStart = now;
    for (let i = 1; i < WINDOW[granularity]; i++)
      windowStart = startOfBucket(new Date(windowStart.getTime() - 1), granularity);

    const allDates = [...raw.created, ...raw.completed].map((r) => startOfBucket(r.bucket, granularity).getTime());
    const minData = allDates.length ? new Date(Math.min(...allDates)) : now;
    let cursor = minData.getTime() > windowStart.getTime() ? minData : windowStart;
    cursor = startOfBucket(cursor, granularity);

    const series: StatsBucket[] = [];
    let guard = 0;
    while (cursor.getTime() <= now.getTime() && guard++ < 500) {
      const key = bucketKey(cursor, granularity);
      series.push({
        bucket: key,
        label: bucketLabel(cursor, granularity),
        created: createdMap.get(key) ?? 0,
        completed: completedMap.get(key) ?? 0,
      });
      cursor = nextBucket(cursor, granularity);
    }

    const { total, pending, completed, avgCompletionHours } = raw.totals;
    return {
      granularity,
      totals: {
        total,
        pending,
        completed,
        completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        avgCompletionHours: avgCompletionHours != null ? Math.round(avgCompletionHours * 10) / 10 : null,
      },
      series,
    };
  }
}
