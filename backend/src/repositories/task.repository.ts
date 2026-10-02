import { getPool, sql } from '../config/database';
import { AppError } from '../utils/AppError';
import type {
  Attachment,
  AttachmentFile,
  DueTask,
  Notifications,
  StatsBucketUnit,
  StatsRange,
  Task,
  TaskPriority,
  TaskRecurrence,
  TaskRow,
  TaskStatus,
} from '../types/task';

export type TaskSortKey =
  | 'newest'
  | 'oldest'
  | 'title_asc'
  | 'title_desc'
  | 'due_asc'
  | 'due_desc'
  | 'priority'
  | 'priority_asc';

export interface FindTasksParams {
  status?: TaskStatus;
  page: number;
  pageSize: number;
  search?: string;
  sort?: TaskSortKey;
  /** YYYY-MM-DD */
  dateFrom?: string;
  /** YYYY-MM-DD (inclusivo) */
  dateTo?: string;
  priority?: TaskPriority;
  category?: string;
}

/** Convierte 'YYYY-MM-DD' a Date en UTC (medianoche); null si no viene. */
function toUtcDate(value?: string): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

/** Normaliza una fecha DATE de SQL Server a 'YYYY-MM-DD'; null si no hay. */
function dateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

/** Traduce la opción de orden del API a (SortBy, SortDir) del stored procedure. */
function mapSort(sort?: TaskSortKey): { by: string; dir: string } {
  switch (sort) {
    case 'oldest':
      return { by: 'date', dir: 'ASC' };
    case 'title_asc':
      return { by: 'title', dir: 'ASC' };
    case 'title_desc':
      return { by: 'title', dir: 'DESC' };
    case 'due_asc':
      return { by: 'due', dir: 'ASC' };
    case 'due_desc':
      return { by: 'due', dir: 'DESC' };
    case 'priority':
      return { by: 'priority', dir: 'DESC' };
    case 'priority_asc':
      return { by: 'priority', dir: 'ASC' };
    default:
      return { by: 'date', dir: 'DESC' };
  }
}

export interface FindTasksResult {
  items: Task[];
  total: number;
}

export interface CreateTaskInput {
  title: string;
  description: string | null;
  priority: TaskPriority;
  category: string | null;
  dueDate: string | null;
  recurrence: TaskRecurrence;
}

export type UpdateTaskInput = CreateTaskInput;

export interface AddAttachmentInput {
  storedName: string;
  originalName: string;
  size: number;
  mimeType: string | null;
}

export interface RawStatsTotals {
  total: number;
  pending: number;
  completed: number;
  avgCompletionHours: number | null;
}

export interface RawBucket {
  /** Fecha de inicio del bucket (UTC, a medianoche). */
  bucket: Date;
  count: number;
}

export interface RawStats {
  totals: RawStatsTotals;
  created: RawBucket[];
  completed: RawBucket[];
}

/** Contrato de acceso a datos: permite sustituir la implementación (p. ej. en tests). */
export interface TaskRepository {
  findPaginated(params: FindTasksParams): Promise<FindTasksResult>;
  create(input: CreateTaskInput): Promise<Task>;
  update(id: number, input: UpdateTaskInput): Promise<Task>;
  updateStatus(id: number, status: TaskStatus): Promise<Task>;
  remove(id: number): Promise<void>;
  bulkUpdateStatus(ids: number[], status: TaskStatus): Promise<number>;
  bulkRemove(ids: number[]): Promise<number>;
  getStats(bucket: StatsBucketUnit, range?: StatsRange): Promise<RawStats>;
  getNotifications(days: number): Promise<Notifications>;
  getDueTasks(): Promise<DueTask[]>;
  addAttachment(taskId: number, input: AddAttachmentInput): Promise<Attachment>;
  getAttachments(taskId: number): Promise<Attachment[]>;
  getAttachment(id: number): Promise<AttachmentFile | null>;
  deleteAttachment(id: number): Promise<string>;
}

/** Códigos de error de negocio lanzados por los stored procedures (THROW 50xxx). */
const SQL_BAD_REQUEST = 50400;
const SQL_NOT_FOUND = 50404;
const SQL_CHECK_CONSTRAINT = 547;

function toTask(row: TaskRow): Task {
  return {
    id: row.Id,
    title: row.Title,
    description: row.Description,
    status: row.Status,
    priority: row.Priority,
    category: row.Category ?? null,
    dueDate: dateOnly(row.DueDate),
    recurrence: row.Recurrence,
    createdAt: row.CreatedAt,
    completedAt: row.CompletedAt ?? null,
  };
}

interface AttachmentRow {
  Id: number;
  TaskId: number;
  StoredName: string;
  OriginalName: string;
  Size: number | string;
  MimeType: string | null;
  CreatedAt: Date;
}
function toAttachment(r: AttachmentRow): AttachmentFile {
  return {
    id: r.Id,
    taskId: r.TaskId,
    storedName: r.StoredName,
    originalName: r.OriginalName,
    size: Number(r.Size),
    mimeType: r.MimeType ?? null,
    createdAt: r.CreatedAt,
  };
}

function sqlErrorNumber(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const candidate = err as { number?: unknown; originalError?: { number?: unknown; info?: { number?: unknown } } };
  const value = candidate.number ?? candidate.originalError?.info?.number ?? candidate.originalError?.number;
  return typeof value === 'number' ? value : undefined;
}

/** Traduce errores de negocio de SQL Server a errores HTTP; el resto se propaga como 500. */
function mapSqlError(err: unknown): never {
  if (err instanceof sql.RequestError) {
    switch (sqlErrorNumber(err)) {
      case SQL_BAD_REQUEST:
        throw AppError.badRequest(err.message);
      case SQL_NOT_FOUND:
        throw AppError.notFound(err.message);
      case SQL_CHECK_CONSTRAINT:
        throw AppError.badRequest('Los datos no cumplen las restricciones de la base de datos');
      default:
        break;
    }
  }
  throw err;
}

export class SqlTaskRepository implements TaskRepository {
  async findPaginated({
    status,
    page,
    pageSize,
    search,
    sort,
    dateFrom,
    dateTo,
    priority,
    category,
  }: FindTasksParams): Promise<FindTasksResult> {
    try {
      const { by, dir } = mapSort(sort);
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Status', sql.NVarChar(20), status ?? null)
        .input('PageNumber', sql.Int, page)
        .input('PageSize', sql.Int, pageSize)
        .input('Search', sql.NVarChar(200), search ?? null)
        .input('SortBy', sql.NVarChar(10), by)
        .input('SortDir', sql.NVarChar(4), dir)
        .input('FromDate', sql.DateTime2, toUtcDate(dateFrom))
        .input('ToDate', sql.DateTime2, toUtcDate(dateTo))
        .input('Priority', sql.NVarChar(10), priority ?? null)
        .input('Category', sql.NVarChar(50), category ?? null)
        .execute('dbo.sp_GetTasks');

      const recordsets = result.recordsets as unknown as [Array<{ TotalCount: number | string }>, TaskRow[]];
      const [countSet, rows] = recordsets;
      // COUNT_BIG llega como string (BIGINT) desde tedious.
      const total = Number(countSet[0]?.TotalCount ?? 0);

      return { items: (rows ?? []).map(toTask), total };
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async create({ title, description, priority, category, dueDate, recurrence }: CreateTaskInput): Promise<Task> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Title', sql.NVarChar(4000), title)
        .input('Description', sql.NVarChar(sql.MAX), description)
        .input('Priority', sql.NVarChar(10), priority)
        .input('Category', sql.NVarChar(50), category)
        .input('DueDate', sql.Date, dueDate)
        .input('Recurrence', sql.NVarChar(10), recurrence)
        .execute<TaskRow>('dbo.sp_CreateTask');

      const row = result.recordset[0];
      if (!row) throw new Error('sp_CreateTask no devolvió el registro creado');
      return toTask(row);
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async update(
    id: number,
    { title, description, priority, category, dueDate, recurrence }: UpdateTaskInput,
  ): Promise<Task> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Priority', sql.NVarChar(10), priority)
        .input('Category', sql.NVarChar(50), category)
        .input('DueDate', sql.Date, dueDate)
        .input('Recurrence', sql.NVarChar(10), recurrence)
        .input('TaskId', sql.Int, id)
        .input('Title', sql.NVarChar(4000), title)
        .input('Description', sql.NVarChar(sql.MAX), description)
        .execute<TaskRow>('dbo.sp_UpdateTask');

      const row = result.recordset[0];
      if (!row) throw AppError.notFound('La tarea solicitada no existe.');
      return toTask(row);
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async remove(id: number): Promise<void> {
    try {
      const pool = await getPool();
      await pool.request().input('TaskId', sql.Int, id).execute('dbo.sp_DeleteTask');
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async bulkUpdateStatus(ids: number[], status: TaskStatus): Promise<number> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Ids', sql.NVarChar(sql.MAX), JSON.stringify(ids))
        .input('Status', sql.NVarChar(20), status)
        .execute<{ Affected: number }>('dbo.sp_BulkUpdateStatus');
      return Number(result.recordset[0]?.Affected ?? 0);
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async bulkRemove(ids: number[]): Promise<number> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Ids', sql.NVarChar(sql.MAX), JSON.stringify(ids))
        .execute<{ Affected: number }>('dbo.sp_BulkDeleteTasks');
      return Number(result.recordset[0]?.Affected ?? 0);
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async updateStatus(id: number, status: TaskStatus): Promise<Task> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('TaskId', sql.Int, id)
        .input('Status', sql.NVarChar(20), status)
        .execute<TaskRow>('dbo.sp_UpdateTaskStatus');

      const row = result.recordset[0];
      if (!row) throw AppError.notFound('La tarea solicitada no existe.');
      return toTask(row);
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async getStats(bucket: StatsBucketUnit, range?: StatsRange): Promise<RawStats> {
    try {
      const pool = await getPool();
      const request = pool.request().input('Granularity', sql.NVarChar(10), bucket);
      request.input('FromDate', sql.Date, range?.from ?? null);
      request.input('ToDate', sql.Date, range?.to ?? null);
      const result = await request.execute('dbo.sp_GetTaskStats');

      const [totalsSet, createdSet, completedSet] = result.recordsets as unknown as [
        Array<{
          Total: number | string;
          Pending: number | string;
          Completed: number | string;
          AvgCompletionHours: number | null;
        }>,
        Array<{ Bucket: Date; Cnt: number | string }>,
        Array<{ Bucket: Date; Cnt: number | string }>,
      ];

      const t = totalsSet[0];
      const toBuckets = (rows: Array<{ Bucket: Date; Cnt: number | string }>): RawBucket[] =>
        (rows ?? []).map((r) => ({ bucket: new Date(r.Bucket), count: Number(r.Cnt) }));

      return {
        totals: {
          total: Number(t?.Total ?? 0),
          pending: Number(t?.Pending ?? 0),
          completed: Number(t?.Completed ?? 0),
          avgCompletionHours: t?.AvgCompletionHours != null ? Number(t.AvgCompletionHours) : null,
        },
        created: toBuckets(createdSet),
        completed: toBuckets(completedSet),
      };
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async getNotifications(days: number): Promise<Notifications> {
    try {
      const pool = await getPool();
      const result = await pool.request().input('Days', sql.Int, days).execute('dbo.sp_GetNotifications');

      const [countsSet, itemsSet] = result.recordsets as unknown as [
        Array<{ Overdue: number | null; DueSoon: number | null }>,
        Array<{
          Id: number;
          Title: string;
          Priority: TaskPriority;
          Category: string | null;
          DueDate: Date | string | null;
          Kind: 'OVERDUE' | 'DUE_SOON';
        }>,
      ];
      const counts = countsSet[0];
      return {
        overdue: Number(counts?.Overdue ?? 0),
        dueSoon: Number(counts?.DueSoon ?? 0),
        items: (itemsSet ?? []).map((r) => ({
          id: r.Id,
          title: r.Title,
          priority: r.Priority,
          category: r.Category ?? null,
          dueDate: dateOnly(r.DueDate),
          kind: r.Kind,
        })),
      };
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async getDueTasks(): Promise<DueTask[]> {
    try {
      const pool = await getPool();
      const result = await pool.request().execute('dbo.sp_GetDueTasks');
      const rows = result.recordset as unknown as Array<{
        Id: number;
        Title: string;
        Description: string | null;
        Priority: TaskPriority;
        Category: string | null;
        DueDate: Date | string;
      }>;
      return rows.map((r) => ({
        id: r.Id,
        title: r.Title,
        description: r.Description ?? null,
        priority: r.Priority,
        category: r.Category ?? null,
        dueDate: dateOnly(r.DueDate) as string,
      }));
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async addAttachment(taskId: number, input: AddAttachmentInput): Promise<Attachment> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('TaskId', sql.Int, taskId)
        .input('StoredName', sql.NVarChar(200), input.storedName)
        .input('OriginalName', sql.NVarChar(260), input.originalName)
        .input('Size', sql.BigInt, input.size)
        .input('MimeType', sql.NVarChar(150), input.mimeType)
        .execute<AttachmentRow>('dbo.sp_AddAttachment');
      const row = result.recordset[0];
      if (!row) throw new Error('sp_AddAttachment no devolvió el registro');
      const { storedName: _s, ...rest } = toAttachment(row);
      void _s;
      return rest;
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async getAttachments(taskId: number): Promise<Attachment[]> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('TaskId', sql.Int, taskId)
        .execute<AttachmentRow>('dbo.sp_GetAttachments');
      return result.recordset.map((r) => {
        const { storedName: _s, ...rest } = toAttachment(r);
        void _s;
        return rest;
      });
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async getAttachment(id: number): Promise<AttachmentFile | null> {
    try {
      const pool = await getPool();
      const result = await pool.request().input('Id', sql.Int, id).execute<AttachmentRow>('dbo.sp_GetAttachment');
      const row = result.recordset[0];
      return row ? toAttachment(row) : null;
    } catch (err) {
      return mapSqlError(err);
    }
  }

  async deleteAttachment(id: number): Promise<string> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Id', sql.Int, id)
        .execute<{ StoredName: string }>('dbo.sp_DeleteAttachment');
      const storedName = result.recordset[0]?.StoredName;
      if (!storedName) throw AppError.notFound('El adjunto solicitado no existe.');
      return storedName;
    } catch (err) {
      return mapSqlError(err);
    }
  }
}
