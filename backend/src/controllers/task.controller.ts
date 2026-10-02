import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import type {
  AttachmentIdParams,
  BulkDeleteDto,
  BulkStatusDto,
  CreateTaskDto,
  ListTasksQuery,
  NotificationsQuery,
  StatsQuery,
  TaskIdParams,
  UpdateTaskDto,
  UpdateTaskStatusDto,
} from '../schemas/task.schema';
import type { TaskService } from '../services/task.service';
import type { ApiSuccess } from '../types/api';
import type { Attachment, Notifications, PaginationMeta, Task, TaskStats } from '../types/task';
import { AppError } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { UPLOAD_DIR } from '../middlewares/upload.middleware';

/**
 * Los datos de entrada ya fueron validados/normalizados por `validate()`,
 * por eso los casts a los DTOs son seguros.
 */
export function createTaskController(taskService: TaskService) {
  return {
    /** GET /api/tasks */
    list: asyncHandler(async (req: Request, res: Response<ApiSuccess<Task[], PaginationMeta>>) => {
      const query = req.query as unknown as ListTasksQuery;
      const result = await taskService.list(query);
      res.status(200).json({ success: true, data: result.items, meta: result.pagination });
    }),

    /** GET /api/tasks/stats */
    stats: asyncHandler(async (req: Request, res: Response<ApiSuccess<TaskStats>>) => {
      const { granularity, from, to, bucket } = req.query as unknown as StatsQuery;
      const stats = await taskService.getStats(granularity, { from, to, bucket });
      res.status(200).json({ success: true, data: stats });
    }),

    /** GET /api/tasks/notifications */
    notifications: asyncHandler(async (req: Request, res: Response<ApiSuccess<Notifications>>) => {
      const { days } = req.query as unknown as NotificationsQuery;
      const data = await taskService.getNotifications(days);
      res.status(200).json({ success: true, data });
    }),

    /** POST /api/tasks */
    create: asyncHandler(async (req: Request, res: Response<ApiSuccess<Task>>) => {
      const task = await taskService.create(req.body as CreateTaskDto);
      res.status(201).location(`/api/tasks/${task.id}`).json({ success: true, data: task });
    }),

    /** PUT /api/tasks/:id — editar título y descripción */
    update: asyncHandler(async (req: Request, res: Response<ApiSuccess<Task>>) => {
      const { id } = req.params as unknown as TaskIdParams;
      const task = await taskService.update(id, req.body as UpdateTaskDto);
      res.status(200).json({ success: true, data: task });
    }),

    /** PATCH /api/tasks/:id/status */
    updateStatus: asyncHandler(async (req: Request, res: Response<ApiSuccess<Task>>) => {
      const { id } = req.params as unknown as TaskIdParams;
      const { status } = req.body as UpdateTaskStatusDto;
      const task = await taskService.updateStatus(id, status);
      res.status(200).json({ success: true, data: task });
    }),

    /** DELETE /api/tasks/:id */
    remove: asyncHandler(async (req: Request, res: Response) => {
      const { id } = req.params as unknown as TaskIdParams;
      await taskService.remove(id);
      res.status(204).send();
    }),

    /** POST /api/tasks/bulk/status — cambiar estado de varias (selección múltiple) */
    bulkStatus: asyncHandler(async (req: Request, res: Response<ApiSuccess<{ affected: number }>>) => {
      const { ids, status } = req.body as BulkStatusDto;
      const affected = await taskService.bulkUpdateStatus(ids, status);
      res.status(200).json({ success: true, data: { affected } });
    }),

    /** POST /api/tasks/bulk/delete — eliminar varias (selección múltiple) */
    bulkRemove: asyncHandler(async (req: Request, res: Response<ApiSuccess<{ affected: number }>>) => {
      const { ids } = req.body as BulkDeleteDto;
      const affected = await taskService.bulkRemove(ids);
      res.status(200).json({ success: true, data: { affected } });
    }),

    // ----- Adjuntos -----

    /** GET /api/tasks/:id/attachments */
    listAttachments: asyncHandler(async (req: Request, res: Response<ApiSuccess<Attachment[]>>) => {
      const { id } = req.params as unknown as TaskIdParams;
      const data = await taskService.getAttachments(id);
      res.status(200).json({ success: true, data });
    }),

    /** POST /api/tasks/:id/attachments (multipart, campo "file") */
    uploadAttachment: asyncHandler(async (req: Request, res: Response<ApiSuccess<Attachment>>) => {
      const { id } = req.params as unknown as TaskIdParams;
      const file = req.file;
      if (!file) throw AppError.badRequest('Debes adjuntar un archivo en el campo "file".');
      try {
        const data = await taskService.addAttachment(id, {
          storedName: file.filename,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype || null,
        });
        res.status(201).json({ success: true, data });
      } catch (err) {
        // Si la tarea no existe (u otro fallo), borramos el archivo ya guardado.
        fs.promises.unlink(path.join(UPLOAD_DIR, file.filename)).catch(() => undefined);
        throw err;
      }
    }),

    /** GET /api/tasks/attachments/:attachmentId/download */
    downloadAttachment: asyncHandler(async (req: Request, res: Response) => {
      const { attachmentId } = req.params as unknown as AttachmentIdParams;
      const att = await taskService.getAttachment(attachmentId);
      if (!att) throw AppError.notFound('El adjunto solicitado no existe.');
      const filePath = path.join(UPLOAD_DIR, att.storedName);
      if (!fs.existsSync(filePath)) throw AppError.notFound('El archivo ya no está disponible.');
      if (att.mimeType) res.type(att.mimeType);
      res.download(filePath, att.originalName);
    }),

    /** DELETE /api/tasks/attachments/:attachmentId */
    removeAttachment: asyncHandler(async (req: Request, res: Response) => {
      const { attachmentId } = req.params as unknown as AttachmentIdParams;
      const storedName = await taskService.deleteAttachment(attachmentId);
      await fs.promises.unlink(path.join(UPLOAD_DIR, storedName)).catch(() => undefined);
      res.status(204).send();
    }),

    // ----- Calendario (.ics) -----

    /** GET /api/tasks/calendar.ics — feed de tareas pendientes con vencimiento */
    calendar: asyncHandler(async (_req: Request, res: Response) => {
      const ics = await taskService.buildCalendar();
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="rumbo.ics"');
      res.status(200).send(ics);
    }),
  };
}
