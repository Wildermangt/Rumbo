import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { useTasks } from './useTasks';
import { tasksApi } from '@/services/tasks.api';
import type { ListTasksParams } from '@/services/tasks.api';
import type { Task } from '@/types/task';

vi.mock('@/services/tasks.api', () => ({
  tasksApi: { list: vi.fn(), create: vi.fn(), updateStatus: vi.fn() },
}));

const mockTask = (over: Partial<Task> = {}): Task => ({
  id: 1,
  title: 'Demo',
  description: null,
  status: 'PENDING',
  priority: 'MEDIUM',
  category: null,
  dueDate: null,
  recurrence: 'NONE',
  createdAt: '2026-09-01T10:00:00Z',
  completedAt: null,
  ...over,
});

const listMock = vi.mocked(tasksApi.list);
const createMock = vi.mocked(tasksApi.create);
const updateMock = vi.mocked(tasksApi.updateStatus);

function listResult(items: Task[], total = items.length) {
  return { items, pagination: { page: 1, pageSize: 10, total, totalPages: Math.ceil(total / 10) } };
}

const lastCall = (): ListTasksParams => listMock.mock.calls.at(-1)![0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  listMock.mockResolvedValue(listResult([mockTask()]));
});
afterEach(() => vi.useRealTimers());

describe('useTasks', () => {
  it('carga tareas y mapea la paginación', async () => {
    const { tasks, pagination, fetchTasks } = useTasks();
    await fetchTasks();
    expect(tasks.value).toHaveLength(1);
    expect(pagination.total).toBe(1);
    expect(lastCall()).toMatchObject({ status: 'ALL', page: 1, pageSize: 10, sort: 'newest' });
  });

  it('reinicia a la página 1 al cambiar el filtro de estado', async () => {
    const { filterStatus, pagination, setPage } = useTasks();
    await setPage(3, 10);
    expect(pagination.page).toBe(3);
    filterStatus.value = 'COMPLETED';
    await nextTick();
    await vi.runAllTimersAsync();
    expect(pagination.page).toBe(1);
    expect(lastCall().status).toBe('COMPLETED');
  });

  it('aplica debounce a la búsqueda (una sola petición)', async () => {
    const { search, fetchTasks } = useTasks();
    await fetchTasks();
    listMock.mockClear();
    search.value = 'a';
    search.value = 'ab';
    search.value = 'abc';
    await nextTick();
    await vi.advanceTimersByTimeAsync(400);
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(lastCall().search).toBe('abc');
  });

  it('envía el rango de fechas y no filtra si el rango es inválido', async () => {
    const { dateFrom, dateTo } = useTasks();
    dateFrom.value = '2026-01-01';
    dateTo.value = '2026-03-31';
    await nextTick();
    await vi.runAllTimersAsync();
    expect(lastCall()).toMatchObject({ dateFrom: '2026-01-01', dateTo: '2026-03-31' });

    listMock.mockClear();
    dateFrom.value = '2026-12-01'; // ahora from > to => no debe disparar fetch
    await nextTick();
    await vi.runAllTimersAsync();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('actualiza el estado localmente con filtro ALL (sin recargar)', async () => {
    const { tasks, updateStatus, fetchTasks } = useTasks();
    await fetchTasks();
    updateMock.mockResolvedValue(mockTask({ status: 'COMPLETED', completedAt: '2026-09-02T10:00:00Z' }));
    listMock.mockClear();
    await updateStatus(1, 'COMPLETED');
    expect(tasks.value[0]!.status).toBe('COMPLETED');
    expect(listMock).not.toHaveBeenCalled(); // actualización optimista
  });

  it('tras crear vuelve a la página 1 y recarga', async () => {
    const { createTask, pagination, setPage } = useTasks();
    await setPage(2, 10);
    createMock.mockResolvedValue(mockTask({ id: 99, title: 'Nueva' }));
    await createTask({ title: 'Nueva', priority: 'MEDIUM', recurrence: 'NONE' });
    expect(pagination.page).toBe(1);
    expect(createMock).toHaveBeenCalledWith({ title: 'Nueva', priority: 'MEDIUM', recurrence: 'NONE' });
  });
});
