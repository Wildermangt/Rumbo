import type { ApiSuccess } from '@/types/api';
import type {
  CreateTaskPayload,
  Pagination,
  StatsGranularity,
  Task,
  TaskFilter,
  TaskStats,
  TaskStatus,
} from '@/types/task';
import { http } from './http';

export type TaskSort = 'newest' | 'oldest' | 'title_asc' | 'title_desc';

export interface ListTasksParams {
  status: TaskFilter;
  page: number;
  pageSize: number;
  search?: string;
  sort?: TaskSort;
  dateFrom?: string;
  dateTo?: string;
}

export interface ListTasksResponse {
  items: Task[];
  pagination: Pagination;
}

export const tasksApi = {
  async list(
    { status, page, pageSize, search, sort, dateFrom, dateTo }: ListTasksParams,
    signal?: AbortSignal,
  ): Promise<ListTasksResponse> {
    const params: Record<string, string | number> = { page, pageSize };
    if (status !== 'ALL') params.status = status;
    if (search) params.search = search;
    if (sort) params.sort = sort;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;

    const { data } = await http.get<ApiSuccess<Task[], Pagination>>('/tasks', { params, signal });
    return {
      items: data.data,
      pagination: data.meta ?? { page, pageSize, total: data.data.length, totalPages: 1 },
    };
  },

  async create(payload: CreateTaskPayload): Promise<Task> {
    const { data } = await http.post<ApiSuccess<Task>>('/tasks', payload);
    return data.data;
  },

  async updateStatus(id: number, status: TaskStatus): Promise<Task> {
    const { data } = await http.patch<ApiSuccess<Task>>(`/tasks/${id}/status`, { status });
    return data.data;
  },

  async stats(granularity: StatsGranularity, signal?: AbortSignal): Promise<TaskStats> {
    const { data } = await http.get<ApiSuccess<TaskStats>>('/tasks/stats', { params: { granularity }, signal });
    return data.data;
  },
};
