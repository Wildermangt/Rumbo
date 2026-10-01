import type { Request, Response } from 'express';
import type {
  CreateTaskDto,
  ListTasksQuery,
  StatsQuery,
  TaskIdParams,
  UpdateTaskStatusDto,
} from '../schemas/task.schema';
import type { TaskService } from '../services/task.service';
import type { ApiSuccess } from '../types/api';
import type { PaginationMeta, Task, TaskStats } from '../types/task';
import { asyncHandler } from '../utils/asyncHandler';

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
      const { granularity } = req.query as unknown as StatsQuery;
      const stats = await taskService.getStats(granularity);
      res.status(200).json({ success: true, data: stats });
    }),

    /** POST /api/tasks */
    create: asyncHandler(async (req: Request, res: Response<ApiSuccess<Task>>) => {
      const task = await taskService.create(req.body as CreateTaskDto);
      res.status(201).location(`/api/tasks/${task.id}`).json({ success: true, data: task });
    }),

    /** PATCH /api/tasks/:id/status */
    updateStatus: asyncHandler(async (req: Request, res: Response<ApiSuccess<Task>>) => {
      const { id } = req.params as unknown as TaskIdParams;
      const { status } = req.body as UpdateTaskStatusDto;
      const task = await taskService.updateStatus(id, status);
      res.status(200).json({ success: true, data: task });
    }),
  };
}
