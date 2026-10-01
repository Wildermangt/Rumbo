import { Router } from 'express';
import { createTaskController } from '../controllers/task.controller';
import { validate } from '../middlewares/validate.middleware';
import {
  createTaskBodySchema,
  listTasksQuerySchema,
  statsQuerySchema,
  taskIdParamsSchema,
  updateTaskStatusBodySchema,
} from '../schemas/task.schema';
import type { TaskService } from '../services/task.service';

export function createTaskRouter(taskService: TaskService): Router {
  const router = Router();
  const controller = createTaskController(taskService);

  // Rutas específicas antes de las dinámicas.
  router.get('/stats', validate({ query: statsQuerySchema }), controller.stats);
  router.get('/', validate({ query: listTasksQuerySchema }), controller.list);
  router.post('/', validate({ body: createTaskBodySchema }), controller.create);
  router.patch(
    '/:id/status',
    validate({ params: taskIdParamsSchema, body: updateTaskStatusBodySchema }),
    controller.updateStatus,
  );

  return router;
}
