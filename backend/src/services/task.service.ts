import type { AddAttachmentInput, RawBucket, TaskRepository } from '../repositories/task.repository';
import type { CreateTaskDto, ListTasksQuery, UpdateTaskDto } from '../schemas/task.schema';
import type {
  Attachment,
  AttachmentFile,
  DueTask,
  Notifications,
  PaginatedResult,
  StatsBucket,
  StatsBucketUnit,
  StatsGranularity,
  StatsRange,
  Task,
  TaskStats,
  TaskStatus,
} from '../types/task';

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Escapa texto para un campo iCalendar (RFC 5545). */
function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Genera un calendario .ics (VCALENDAR) con una tarea por VEVENT de día completo. */
function buildIcs(tasks: DueTask[]): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rumbo//Tareas//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const t of tasks) {
    const ymd = t.dueDate.replace(/-/g, '');
    const next = new Date(`${t.dueDate}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const nextYmd = `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, '0')}${String(next.getUTCDate()).padStart(2, '0')}`;
    const prio = { HIGH: 'Alta', MEDIUM: 'Media', LOW: 'Baja' }[t.priority];
    const desc = [t.description, `Prioridad: ${prio}`, t.category ? `Categoría: ${t.category}` : null]
      .filter(Boolean)
      .join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:rumbo-task-${t.id}@rumbo.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ymd}`,
      `DTEND;VALUE=DATE:${nextYmd}`,
      `SUMMARY:${icsEscape(t.title)}`,
      ...(desc ? [`DESCRIPTION:${icsEscape(desc)}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Nº de buckets recientes a mostrar cuando no hay periodo seleccionado. */
const WINDOW: Record<StatsBucketUnit, number> = { day: 14, week: 12, month: 12, year: 6 };

/** Normaliza una fecha al inicio de su bucket (UTC) según la unidad. */
function startOfBucket(date: Date, g: StatsBucketUnit): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (g === 'year') return new Date(Date.UTC(y, 0, 1));
  if (g === 'month') return new Date(Date.UTC(y, m, 1));
  if (g === 'day') return new Date(Date.UTC(y, m, date.getUTCDate()));
  // week: lunes de la semana
  const dow = (date.getUTCDay() + 6) % 7; // lunes = 0
  return new Date(Date.UTC(y, m, date.getUTCDate() - dow));
}

function nextBucket(date: Date, g: StatsBucketUnit): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const d = date.getUTCDate();
  if (g === 'year') return new Date(Date.UTC(y + 1, 0, 1));
  if (g === 'month') return new Date(Date.UTC(y, m + 1, 1));
  if (g === 'day') return new Date(Date.UTC(y, m, d + 1));
  return new Date(Date.UTC(y, m, d + 7));
}

function bucketKey(date: Date, g: StatsBucketUnit): string {
  const y = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  if (g === 'year') return `${y}`;
  if (g === 'month') return `${y}-${mm}`;
  return `${y}-${mm}-${dd}`;
}

function bucketLabel(date: Date, g: StatsBucketUnit): string {
  const y = date.getUTCFullYear();
  const mon = MONTHS_ES[date.getUTCMonth()];
  if (g === 'year') return `${y}`;
  if (g === 'month') return `${mon} ${y}`;
  return `${date.getUTCDate()} ${mon}`;
}

/** Parsea 'YYYY-MM-DD' a un Date UTC (medianoche). */
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
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
      priority: query.priority,
      category: query.category,
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
    return this.repository.create({
      title: dto.title,
      description: dto.description,
      priority: dto.priority,
      category: dto.category,
      dueDate: dto.dueDate,
      recurrence: dto.recurrence,
    });
  }

  update(id: number, dto: UpdateTaskDto): Promise<Task> {
    return this.repository.update(id, {
      title: dto.title,
      description: dto.description,
      priority: dto.priority,
      category: dto.category,
      dueDate: dto.dueDate,
      recurrence: dto.recurrence,
    });
  }

  getNotifications(days: number): Promise<Notifications> {
    return this.repository.getNotifications(days);
  }

  // ----- Adjuntos -----
  addAttachment(taskId: number, input: AddAttachmentInput): Promise<Attachment> {
    return this.repository.addAttachment(taskId, input);
  }
  getAttachments(taskId: number): Promise<Attachment[]> {
    return this.repository.getAttachments(taskId);
  }
  getAttachment(id: number): Promise<AttachmentFile | null> {
    return this.repository.getAttachment(id);
  }
  deleteAttachment(id: number): Promise<string> {
    return this.repository.deleteAttachment(id);
  }

  // ----- Calendario (iCalendar / .ics) -----
  getDueTasks(): Promise<DueTask[]> {
    return this.repository.getDueTasks();
  }

  async buildCalendar(): Promise<string> {
    const tasks = await this.repository.getDueTasks();
    return buildIcs(tasks);
  }

  updateStatus(id: number, status: TaskStatus): Promise<Task> {
    return this.repository.updateStatus(id, status);
  }

  remove(id: number): Promise<void> {
    return this.repository.remove(id);
  }

  bulkUpdateStatus(ids: number[], status: TaskStatus): Promise<number> {
    return this.repository.bulkUpdateStatus(ids, status);
  }

  bulkRemove(ids: number[]): Promise<number> {
    return this.repository.bulkRemove(ids);
  }

  async getStats(granularity: StatsGranularity, range?: StatsRange): Promise<TaskStats> {
    // Unidad real de agrupación: la indicada (al analizar un periodo) o la del toggle.
    const unit: StatsBucketUnit = range?.bucket ?? granularity;
    const raw = await this.repository.getStats(unit, range);

    const index = (rows: RawBucket[]): Map<string, number> => {
      const map = new Map<string, number>();
      for (const r of rows) map.set(bucketKey(startOfBucket(r.bucket, unit), unit), r.count);
      return map;
    };
    const createdMap = index(raw.created);
    const completedMap = index(raw.completed);

    // Rango de la serie: el periodo seleccionado, o una ventana reciente si no hay periodo.
    const now = startOfBucket(new Date(), unit);
    let start: Date;
    let end: Date;
    if (range?.from && range?.to) {
      start = startOfBucket(parseYmd(range.from), unit);
      end = startOfBucket(parseYmd(range.to), unit);
    } else {
      let windowStart = now;
      for (let i = 1; i < WINDOW[unit]; i++)
        windowStart = startOfBucket(new Date(windowStart.getTime() - 1), unit);
      const allDates = [...raw.created, ...raw.completed].map((r) => startOfBucket(r.bucket, unit).getTime());
      const minData = allDates.length ? new Date(Math.min(...allDates)) : now;
      start = startOfBucket(minData.getTime() > windowStart.getTime() ? minData : windowStart, unit);
      end = now;
    }

    const series: StatsBucket[] = [];
    let cursor = start;
    let guard = 0;
    while (cursor.getTime() <= end.getTime() && guard++ < 1000) {
      const key = bucketKey(cursor, unit);
      series.push({
        bucket: key,
        label: bucketLabel(cursor, unit),
        created: createdMap.get(key) ?? 0,
        completed: completedMap.get(key) ?? 0,
      });
      cursor = nextBucket(cursor, unit);
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
