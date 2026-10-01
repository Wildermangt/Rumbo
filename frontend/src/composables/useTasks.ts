import { reactive, readonly, ref, watch } from 'vue';
import { getErrorMessage } from '@/services/http';
import { tasksApi, type TaskSort } from '@/services/tasks.api';
import type { CreateTaskPayload, Pagination, Task, TaskFilter, TaskStatus } from '@/types/task';

/**
 * Encapsula el estado y las operaciones de tareas.
 * - Cancela peticiones obsoletas (AbortController) para evitar condiciones de carrera.
 * - Búsqueda server-side con debounce y orden configurable.
 * - Estados de carga independientes para listado, creación y cada fila.
 */
export function useTasks(initialPageSize = 10) {
  const tasks = ref<Task[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const updatingIds = ref<number[]>([]);
  const error = ref<string | null>(null);
  const filterStatus = ref<TaskFilter>('ALL');
  const search = ref('');
  const sort = ref<TaskSort>('newest');
  const dateFrom = ref('');
  const dateTo = ref('');
  const pagination = reactive<Pagination>({ page: 1, pageSize: initialPageSize, total: 0, totalPages: 0 });

  let controller: AbortController | null = null;

  async function fetchTasks(): Promise<void> {
    controller?.abort();
    const current = new AbortController();
    controller = current;

    loading.value = true;
    error.value = null;
    try {
      const result = await tasksApi.list(
        {
          status: filterStatus.value,
          page: pagination.page,
          pageSize: pagination.pageSize,
          search: search.value.trim() || undefined,
          sort: sort.value,
          dateFrom: dateFrom.value || undefined,
          dateTo: dateTo.value || undefined,
        },
        current.signal,
      );
      tasks.value = result.items;
      pagination.total = result.pagination.total;
      pagination.totalPages = result.pagination.totalPages;

      // Si la página quedó fuera de rango (p. ej. al filtrar/buscar), retroceder.
      if (result.items.length === 0 && pagination.page > 1 && pagination.page > result.pagination.totalPages) {
        pagination.page = Math.max(1, result.pagination.totalPages);
        await fetchTasks();
      }
    } catch (err) {
      if (current.signal.aborted) return;
      error.value = getErrorMessage(err);
      tasks.value = [];
      pagination.total = 0;
      pagination.totalPages = 0;
    } finally {
      if (controller === current) loading.value = false;
    }
  }

  function setPage(page: number, pageSize: number): Promise<void> {
    if (pageSize !== pagination.pageSize) page = 1;
    pagination.page = page;
    pagination.pageSize = pageSize;
    return fetchTasks();
  }

  async function createTask(payload: CreateTaskPayload): Promise<Task> {
    saving.value = true;
    try {
      const task = await tasksApi.create(payload);
      pagination.page = 1;
      await fetchTasks();
      return task;
    } finally {
      saving.value = false;
    }
  }

  async function updateStatus(id: number, status: TaskStatus): Promise<Task> {
    updatingIds.value = [...updatingIds.value, id];
    try {
      const updated = await tasksApi.updateStatus(id, status);
      if (filterStatus.value === 'ALL') {
        tasks.value = tasks.value.map((t) => (t.id === id ? updated : t));
      } else {
        await fetchTasks();
      }
      return updated;
    } finally {
      updatingIds.value = updatingIds.value.filter((x) => x !== id);
    }
  }

  const isUpdating = (id: number): boolean => updatingIds.value.includes(id);

  // Filtro de estado, orden y fechas: recargan de inmediato desde la página 1.
  // El rango admite extremos abiertos (solo desde, o solo hasta).
  watch([filterStatus, sort, dateFrom, dateTo], () => {
    if (dateFrom.value && dateTo.value && dateFrom.value > dateTo.value) return; // rango inválido
    pagination.page = 1;
    void fetchTasks();
  });

  // Búsqueda: debounce de 350 ms para no disparar una petición por tecla.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  watch(search, () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      pagination.page = 1;
      void fetchTasks();
    }, 350);
  });

  function clearSearch(): void {
    if (!search.value) return;
    search.value = '';
  }

  function clearDates(): void {
    if (!dateFrom.value && !dateTo.value) return;
    dateFrom.value = '';
    dateTo.value = '';
  }

  return {
    tasks: readonly(tasks),
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    pagination: readonly(pagination),
    filterStatus,
    search,
    sort,
    dateFrom,
    dateTo,
    fetchTasks,
    setPage,
    createTask,
    updateStatus,
    isUpdating,
    clearSearch,
    clearDates,
  };
}
