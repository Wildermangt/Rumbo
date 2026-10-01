import { getPool, sql } from '../config/database';
import { AppError } from '../utils/AppError';
import type { StatsGranularity, Task, TaskRow, TaskStatus } from '../types/task';

export interface FindTasksParams {
  status?: TaskStatus;
  page: number;
  pageSize: number;
  search?: string;
  sort?: 'newest' | 'oldest' | 'title_asc' | 'title_desc';
  /** YYYY-MM-DD */
  dateFrom?: string;
  /** YYYY-MM-DD (inclusivo) */
  dateTo?: string;
}

/** Convierte 'YYYY-MM-DD' a Date en UTC (medianoche); null si no viene. */
function toUtcDate(value?: string): Date | null {
  return value ? new Date(`${value}T00:00:00Z`) : null;
}

export interface FindTasksResult {
  items: Task[];
  total: number;
}

export interface CreateTaskInput {
  title: string;
  description: string | null;
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
  updateStatus(id: number, status: TaskStatus): Promise<Task>;
  getStats(granularity: StatsGranularity): Promise<RawStats>;
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
    createdAt: row.CreatedAt,
    completedAt: row.CompletedAt ?? null,
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
  }: FindTasksParams): Promise<FindTasksResult> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Status', sql.NVarChar(20), status ?? null)
        .input('PageNumber', sql.Int, page)
        .input('PageSize', sql.Int, pageSize)
        .input('Search', sql.NVarChar(200), search ?? null)
        .input('SortBy', sql.NVarChar(10), sort === 'title_asc' || sort === 'title_desc' ? 'title' : 'date')
        .input('SortDir', sql.NVarChar(4), sort === 'oldest' || sort === 'title_asc' ? 'ASC' : 'DESC')
        .input('FromDate', sql.DateTime2, toUtcDate(dateFrom))
        .input('ToDate', sql.DateTime2, toUtcDate(dateTo))
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

  async create({ title, description }: CreateTaskInput): Promise<Task> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Title', sql.NVarChar(4000), title)
        .input('Description', sql.NVarChar(sql.MAX), description)
        .execute<TaskRow>('dbo.sp_CreateTask');

      const row = result.recordset[0];
      if (!row) throw new Error('sp_CreateTask no devolvió el registro creado');
      return toTask(row);
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

  async getStats(granularity: StatsGranularity): Promise<RawStats> {
    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input('Granularity', sql.NVarChar(10), granularity)
        .execute('dbo.sp_GetTaskStats');

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
}
