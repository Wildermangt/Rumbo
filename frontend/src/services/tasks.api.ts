import type { ApiSuccess } from '@/types/api';
import type {
  Attachment,
  CreateTaskPayload,
  Notifications,
  Pagination,
  PriorityFilter,
  StatsGranularity,
  StatsRange,
  Task,
  TaskFilter,
  TaskStats,
  TaskStatus,
} from '@/types/task';
import { http } from './http';

export type TaskSort =
  'newest' | 'oldest' | 'title_asc' | 'title_desc' | 'due_asc' | 'due_desc' | 'priority' | 'priority_asc';

export interface ListTasksParams {
  status: TaskFilter;
  page: number;
  pageSize: number;
  search?: string;
  sort?: TaskSort;
  dateFrom?: string;
  dateTo?: string;
  priority?: PriorityFilter;
  category?: string;
}

export interface ListTasksResponse {
  items: Task[];
  pagination: Pagination;
}

export const tasksApi = {
  async list(
    { status, page, pageSize, search, sort, dateFrom, dateTo, priority, category }: ListTasksParams,
    signal?: AbortSignal,
  ): Promise<ListTasksResponse> {
    const params: Record<string, string | number> = { page, pageSize };
    if (priority && priority !== 'ALL') params.priority = priority;
    if (category) params.category = category;
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

  async update(id: number, payload: CreateTaskPayload): Promise<Task> {
    const { data } = await http.put<ApiSuccess<Task>>(`/tasks/${id}`, payload);
    return data.data;
  },

  async updateStatus(id: number, status: TaskStatus): Promise<Task> {
    const { data } = await http.patch<ApiSuccess<Task>>(`/tasks/${id}/status`, { status });
    return data.data;
  },

  async remove(id: number): Promise<void> {
    await http.delete(`/tasks/${id}`);
  },

  async bulkStatus(ids: number[], status: TaskStatus): Promise<number> {
    const { data } = await http.post<ApiSuccess<{ affected: number }>>('/tasks/bulk/status', { ids, status });
    return data.data.affected;
  },

  async bulkRemove(ids: number[]): Promise<number> {
    const { data } = await http.post<ApiSuccess<{ affected: number }>>('/tasks/bulk/delete', { ids });
    return data.data.affected;
  },

  async stats(granularity: StatsGranularity, range?: StatsRange, signal?: AbortSignal): Promise<TaskStats> {
    const params: Record<string, string> = { granularity };
    if (range?.from) params.from = range.from;
    if (range?.to) params.to = range.to;
    if (range?.bucket) params.bucket = range.bucket;
    const { data } = await http.get<ApiSuccess<TaskStats>>('/tasks/stats', { params, signal });
    return data.data;
  },

  async notifications(signal?: AbortSignal): Promise<Notifications> {
    const { data } = await http.get<ApiSuccess<Notifications>>('/tasks/notifications', { signal });
    return data.data;
  },

  // ----- Adjuntos -----
  async listAttachments(taskId: number): Promise<Attachment[]> {
    const { data } = await http.get<ApiSuccess<Attachment[]>>(`/tasks/${taskId}/attachments`);
    return data.data;
  },

  async uploadAttachment(taskId: number, file: File): Promise<Attachment> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await http.post<ApiSuccess<Attachment>>(`/tasks/${taskId}/attachments`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return data.data;
  },

  async removeAttachment(attachmentId: number): Promise<void> {
    await http.delete(`/tasks/attachments/${attachmentId}`);
  },

  /** Descarga el archivo (con token) y lo guarda en el navegador. */
  async downloadAttachment(att: Attachment): Promise<void> {
    const res = await http.get(`/tasks/attachments/${att.id}/download`, { responseType: 'blob' });
    triggerDownload(res.data as Blob, att.originalName);
  },

  /** Obtiene el archivo como Blob (para previsualizarlo sin descargarlo). */
  async fetchAttachmentBlob(att: Attachment): Promise<Blob> {
    const res = await http.get(`/tasks/attachments/${att.id}/download`, { responseType: 'blob' });
    return res.data as Blob;
  },

  // ----- Calendario -----
  /** Descarga el feed .ics con todas las tareas pendientes con vencimiento. */
  async downloadCalendar(): Promise<void> {
    const res = await http.get('/tasks/calendar.ics', { responseType: 'blob' });
    triggerDownload(res.data as Blob, 'rumbo.ics');
  },
};

/** Fuerza la descarga de un Blob con un nombre de archivo. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** URL de "Añadir a Google Calendar" para una tarea con vencimiento (evento de día completo). */
export function googleCalendarUrl(task: { title: string; description?: string | null; dueDate: string }): string {
  const ymd = task.dueDate.replace(/-/g, '');
  const next = new Date(`${task.dueDate}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextYmd = `${next.getUTCFullYear()}${String(next.getUTCMonth() + 1).padStart(2, '0')}${String(next.getUTCDate()).padStart(2, '0')}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: task.title,
    dates: `${ymd}/${nextYmd}`,
    details: task.description ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
