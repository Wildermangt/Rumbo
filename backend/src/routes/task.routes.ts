import { type NextFunction, type Request, type Response, Router } from 'express';
import multer from 'multer';
import { createTaskController } from '../controllers/task.controller';
import { validate } from '../middlewares/validate.middleware';
import { uploadSingle } from '../middlewares/upload.middleware';
import {
  attachmentIdParamsSchema,
  bulkDeleteBodySchema,
  bulkStatusBodySchema,
  createTaskBodySchema,
  listTasksQuerySchema,
  notificationsQuerySchema,
  statsQuerySchema,
  taskIdParamsSchema,
  updateTaskBodySchema,
  updateTaskStatusBodySchema,
} from '../schemas/task.schema';
import type { TaskService } from '../services/task.service';
import { AppError } from '../utils/AppError';

/** Ejecuta multer y traduce sus errores (p. ej. tamaño excedido) a AppError. */
function handleUpload(req: Request, res: Response, next: NextFunction): void {
  uploadSingle(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(new AppError(413, 'BAD_REQUEST', 'El archivo supera el tamaño máximo permitido.'));
        return;
      }
      next(AppError.badRequest(`Error al subir el archivo: ${err.message}`));
      return;
    }
    next(err as Error | undefined);
  });
}

export function createTaskRouter(taskService: TaskService): Router {
  const router = Router();
  const controller = createTaskController(taskService);

  // Rutas específicas antes de las dinámicas.
  router.get('/stats', validate({ query: statsQuerySchema }), controller.stats);
  router.get('/notifications', validate({ query: notificationsQuerySchema }), controller.notifications);
  router.get('/calendar.ics', controller.calendar);

  // Acciones en lote (selección múltiple).
  router.post('/bulk/status', validate({ body: bulkStatusBodySchema }), controller.bulkStatus);
  router.post('/bulk/delete', validate({ body: bulkDeleteBodySchema }), controller.bulkRemove);

  // Adjuntos.
  router.get('/:id/attachments', validate({ params: taskIdParamsSchema }), controller.listAttachments);
  router.post('/:id/attachments', validate({ params: taskIdParamsSchema }), handleUpload, controller.uploadAttachment);
  router.get(
    '/attachments/:attachmentId/download',
    validate({ params: attachmentIdParamsSchema }),
    controller.downloadAttachment,
  );
  router.delete(
    '/attachments/:attachmentId',
    validate({ params: attachmentIdParamsSchema }),
    controller.removeAttachment,
  );

  router.get('/', validate({ query: listTasksQuerySchema }), controller.list);
  router.post('/', validate({ body: createTaskBodySchema }), controller.create);

  // CRUD sobre una tarea concreta.
  router.put('/:id', validate({ params: taskIdParamsSchema, body: updateTaskBodySchema }), controller.update);
  router.delete('/:id', validate({ params: taskIdParamsSchema }), controller.remove);
  router.patch(
    '/:id/status',
    validate({ params: taskIdParamsSchema, body: updateTaskStatusBodySchema }),
    controller.updateStatus,
  );

  return router;
}
