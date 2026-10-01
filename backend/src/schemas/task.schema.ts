import { z } from 'zod';
import { TASK_STATUSES } from '../types/task';

const upperTrim = (value: unknown): unknown => (typeof value === 'string' ? value.trim().toUpperCase() : value);

/** GET /api/tasks?status=PENDING&page=1&pageSize=10&search=texto&sort=newest */
export const listTasksQuerySchema = z
  .object({
    status: z
      .preprocess(upperTrim, z.enum(['ALL', ...TASK_STATUSES]).optional())
      .transform((value) => (value === 'ALL' ? undefined : value)),
    page: z.coerce.number().int('page debe ser entero').min(1, 'page debe ser >= 1').max(1_000_000).default(1),
    pageSize: z.coerce
      .number()
      .int('pageSize debe ser entero')
      .min(1, 'pageSize debe ser >= 1')
      .max(100, 'pageSize no puede superar 100')
      .default(10),
    // Búsqueda libre por título/descripción (opcional).
    search: z
      .string()
      .trim()
      .max(200, 'search no puede superar 200 caracteres')
      .optional()
      .transform((value) => (value ? value : undefined)),
    // Orden: por fecha (newest/oldest) o alfabético por título (title_asc/title_desc).
    sort: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.enum(['newest', 'oldest', 'title_asc', 'title_desc']),
      )
      .default('newest'),
    // Rango de fechas de creación (YYYY-MM-DD), ambos opcionales.
    dateFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateFrom debe tener formato YYYY-MM-DD')
      .optional(),
    dateTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateTo debe tener formato YYYY-MM-DD')
      .optional(),
  })
  .strict()
  .refine((q) => !(q.dateFrom && q.dateTo) || q.dateFrom <= q.dateTo, {
    message: 'El rango de fechas es inválido: dateFrom no puede ser posterior a dateTo.',
    path: ['dateFrom'],
  });

/** POST /api/tasks */
export const createTaskBodySchema = z
  .object({
    title: z
      .string({ required_error: 'title es obligatorio', invalid_type_error: 'title debe ser texto' })
      .trim()
      .min(1, 'title no puede estar vacío')
      .max(150, 'title no puede superar 150 caracteres'),
    description: z
      .string({ invalid_type_error: 'description debe ser texto' })
      .trim()
      .max(4000, 'description no puede superar 4000 caracteres')
      .nullish()
      .transform((value) => (value ? value : null)),
  })
  .strict();

/** PATCH /api/tasks/:id/status */
export const taskIdParamsSchema = z
  .object({
    id: z.coerce
      .number({ invalid_type_error: 'id debe ser numérico' })
      .int('id debe ser entero')
      .positive('id debe ser positivo')
      .max(2_147_483_647, 'id fuera de rango'),
  })
  .strict();

export const updateTaskStatusBodySchema = z
  .object({
    status: z.preprocess(
      upperTrim,
      z.enum(TASK_STATUSES, {
        errorMap: () => ({ message: `status debe ser uno de: ${TASK_STATUSES.join(', ')}` }),
      }),
    ),
  })
  .strict();

/** GET /api/tasks/stats?granularity=month */
export const statsQuerySchema = z
  .object({
    granularity: z
      .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['week', 'month', 'year']))
      .default('month'),
  })
  .strict();

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type CreateTaskDto = z.infer<typeof createTaskBodySchema>;
export type TaskIdParams = z.infer<typeof taskIdParamsSchema>;
export type UpdateTaskStatusDto = z.infer<typeof updateTaskStatusBodySchema>;
