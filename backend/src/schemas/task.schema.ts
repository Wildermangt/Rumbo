import { z } from 'zod';
import { TASK_PRIORITIES, TASK_RECURRENCES, TASK_STATUSES } from '../types/task';

const upperTrim = (value: unknown): unknown => (typeof value === 'string' ? value.trim().toUpperCase() : value);

/** Prioridad opcional que por defecto es MEDIUM. */
const prioritySchema = z.preprocess(upperTrim, z.enum(TASK_PRIORITIES)).default('MEDIUM');
/** Recurrencia opcional que por defecto es NONE. */
const recurrenceSchema = z.preprocess(upperTrim, z.enum(TASK_RECURRENCES)).default('NONE');
/** Categoría opcional (texto corto); '' se trata como null. */
const categorySchema = z
  .string()
  .trim()
  .max(50, 'category no puede superar 50 caracteres')
  .nullish()
  .transform((v) => (v ? v : null));
/** Fecha de vencimiento YYYY-MM-DD opcional; '' o ausente => null. */
const dueDateSchema = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate debe tener formato YYYY-MM-DD'), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

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
    // Orden: por fecha, alfabético, vencimiento o prioridad.
    sort: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.enum(['newest', 'oldest', 'title_asc', 'title_desc', 'due_asc', 'due_desc', 'priority', 'priority_asc']),
      )
      .default('newest'),
    // Filtros por prioridad y categoría.
    priority: z.preprocess(upperTrim, z.enum(TASK_PRIORITIES).optional()),
    category: z
      .string()
      .trim()
      .max(50)
      .optional()
      .transform((v) => (v ? v : undefined)),
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
    priority: prioritySchema,
    category: categorySchema,
    dueDate: dueDateSchema,
    recurrence: recurrenceSchema,
  })
  .strict();

/** Params con id de adjunto (/attachments/:attachmentId). */
export const attachmentIdParamsSchema = z
  .object({
    attachmentId: z.coerce.number().int().positive().max(2_147_483_647),
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

/** PUT /api/tasks/:id (editar título y descripción) — mismas reglas que al crear. */
export const updateTaskBodySchema = createTaskBodySchema;

/** POST /api/tasks/bulk/status y /api/tasks/bulk/delete */
const idsSchema = z
  .array(z.number().int('cada id debe ser entero').positive('cada id debe ser positivo'))
  .min(1, 'Debe seleccionar al menos una tarea')
  .max(200, 'No se pueden procesar más de 200 a la vez');

export const bulkStatusBodySchema = z
  .object({
    ids: idsSchema,
    status: z.preprocess(
      upperTrim,
      z.enum(TASK_STATUSES, { errorMap: () => ({ message: `status debe ser uno de: ${TASK_STATUSES.join(', ')}` }) }),
    ),
  })
  .strict();

export const bulkDeleteBodySchema = z.object({ ids: idsSchema }).strict();

/** GET /api/tasks/notifications?days=3 */
export const notificationsQuerySchema = z
  .object({
    days: z.coerce.number().int().min(0).max(60).default(3),
  })
  .strict();

/** GET /api/tasks/stats?granularity=month&from=2026-10-01&to=2026-10-31&bucket=day */
export const statsQuerySchema = z
  .object({
    granularity: z
      .preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.enum(['week', 'month', 'year']))
      .default('month'),
    // Periodo opcional a analizar (YYYY-MM-DD) y unidad de agrupación.
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'from debe tener formato YYYY-MM-DD')
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'to debe tener formato YYYY-MM-DD')
      .optional(),
    bucket: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
        z.enum(['day', 'week', 'month', 'year']),
      )
      .optional(),
  })
  .strict()
  .refine((q) => !(q.from && q.to) || q.from <= q.to, {
    message: 'El rango de fechas es inválido: from no puede ser posterior a to.',
    path: ['from'],
  });

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
export type CreateTaskDto = z.infer<typeof createTaskBodySchema>;
export type UpdateTaskDto = z.infer<typeof updateTaskBodySchema>;
export type TaskIdParams = z.infer<typeof taskIdParamsSchema>;
export type AttachmentIdParams = z.infer<typeof attachmentIdParamsSchema>;
export type UpdateTaskStatusDto = z.infer<typeof updateTaskStatusBodySchema>;
export type BulkStatusDto = z.infer<typeof bulkStatusBodySchema>;
export type BulkDeleteDto = z.infer<typeof bulkDeleteBodySchema>;
