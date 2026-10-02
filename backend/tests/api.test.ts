import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type {
  AddAttachmentInput,
  CreateTaskInput,
  FindTasksParams,
  FindTasksResult,
  RawStats,
  TaskRepository,
  UpdateTaskInput,
} from '../src/repositories/task.repository';
import type { AttachmentFile, Notifications, StatsBucketUnit, StatsRange } from '../src/types/task';
import { AuthService } from '../src/services/auth.service';
import { TaskService } from '../src/services/task.service';
import type { Task, TaskStatus } from '../src/types/task';
import { AppError } from '../src/utils/AppError';

/** Repositorio en memoria que imita el comportamiento de los stored procedures. */
class InMemoryTaskRepository implements TaskRepository {
  private tasks: Task[] = [];
  private nextId = 1;

  async findPaginated({
    status,
    page,
    pageSize,
    search,
    sort,
    dateFrom,
    dateTo,
    priority,
    category,
  }: FindTasksParams): Promise<FindTasksResult> {
    const needle = search?.trim().toLowerCase();
    const byTitle = sort === 'title_asc' || sort === 'title_desc';
    const dir = sort === 'oldest' || sort === 'title_asc' ? 1 : -1;
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00Z`).getTime() : null;
    const toExcl = dateTo ? new Date(`${dateTo}T00:00:00Z`).getTime() + 86_400_000 : null;
    const filtered = this.tasks
      .filter((t) => !status || t.status === status)
      .filter(
        (t) =>
          !needle || t.title.toLowerCase().includes(needle) || (t.description?.toLowerCase().includes(needle) ?? false),
      )
      .filter((t) => !priority || t.priority === priority)
      .filter((t) => !category || t.category === category)
      .filter((t) => from === null || t.createdAt.getTime() >= from)
      .filter((t) => toExcl === null || t.createdAt.getTime() < toExcl)
      .sort((a, b) =>
        byTitle
          ? dir * a.title.localeCompare(b.title)
          : dir * (a.createdAt.getTime() - b.createdAt.getTime()) || b.id - a.id,
      );
    const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize), total: filtered.length };
  }

  async create({ title, description, priority, category, dueDate, recurrence }: CreateTaskInput): Promise<Task> {
    const task: Task = {
      id: this.nextId++,
      title,
      description,
      status: 'PENDING',
      priority,
      category,
      dueDate,
      recurrence,
      createdAt: new Date(),
      completedAt: null,
    };
    this.tasks.push(task);
    return task;
  }

  async update(
    id: number,
    { title, description, priority, category, dueDate, recurrence }: UpdateTaskInput,
  ): Promise<Task> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw AppError.notFound('La tarea solicitada no existe.');
    task.title = title;
    task.description = description;
    task.priority = priority;
    task.category = category;
    task.dueDate = dueDate;
    task.recurrence = recurrence;
    return task;
  }

  async updateStatus(id: number, status: TaskStatus): Promise<Task> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw AppError.notFound('La tarea solicitada no existe.');
    task.status = status;
    task.completedAt = status === 'COMPLETED' ? new Date() : null;
    // Recurrencia: al completar, genera la siguiente ocurrencia.
    if (status === 'COMPLETED' && task.recurrence !== 'NONE') {
      const base = task.dueDate ? new Date(`${task.dueDate}T00:00:00Z`) : new Date();
      const add = { DAILY: 1, WEEKLY: 7, MONTHLY: 30, NONE: 0 }[task.recurrence];
      base.setUTCDate(base.getUTCDate() + add);
      this.tasks.push({
        id: this.nextId++,
        title: task.title,
        description: task.description,
        status: 'PENDING',
        priority: task.priority,
        category: task.category,
        dueDate: base.toISOString().slice(0, 10),
        recurrence: task.recurrence,
        createdAt: new Date(),
        completedAt: null,
      });
    }
    return task;
  }

  async remove(id: number): Promise<void> {
    const i = this.tasks.findIndex((t) => t.id === id);
    if (i === -1) throw AppError.notFound('La tarea solicitada no existe.');
    this.tasks.splice(i, 1);
  }

  async bulkUpdateStatus(ids: number[], status: TaskStatus): Promise<number> {
    let affected = 0;
    for (const t of this.tasks) {
      if (ids.includes(t.id)) {
        t.status = status;
        t.completedAt = status === 'COMPLETED' ? new Date() : null;
        affected++;
      }
    }
    return affected;
  }

  async bulkRemove(ids: number[]): Promise<number> {
    const before = this.tasks.length;
    this.tasks = this.tasks.filter((t) => !ids.includes(t.id));
    return before - this.tasks.length;
  }

  async getStats(_bucket: StatsBucketUnit, _range?: StatsRange): Promise<RawStats> {
    const completed = this.tasks.filter((t) => t.completedAt);
    const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const group = (rows: Date[]) => {
      const m = new Map<number, number>();
      for (const d of rows) {
        const k = startOfMonth(d).getTime();
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].map(([k, count]) => ({ bucket: new Date(k), count }));
    };
    return {
      totals: {
        total: this.tasks.length,
        pending: this.tasks.filter((t) => t.status === 'PENDING').length,
        completed: completed.length,
        avgCompletionHours: completed.length ? 2 : null,
      },
      created: group(this.tasks.map((t) => t.createdAt)),
      completed: group(completed.map((t) => t.completedAt as Date)),
    };
  }

  async getNotifications(days: number): Promise<Notifications> {
    const today = new Date().toISOString().slice(0, 10);
    const limit = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    const pending = this.tasks.filter((t) => t.status === 'PENDING' && t.dueDate);
    const overdue = pending.filter((t) => t.dueDate! < today);
    const dueSoon = pending.filter((t) => t.dueDate! >= today && t.dueDate! <= limit);
    const items = [...overdue, ...dueSoon].map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      category: t.category,
      dueDate: t.dueDate,
      kind: (t.dueDate! < today ? 'OVERDUE' : 'DUE_SOON') as 'OVERDUE' | 'DUE_SOON',
    }));
    return { overdue: overdue.length, dueSoon: dueSoon.length, items };
  }

  async getDueTasks() {
    return this.tasks
      .filter((t) => t.status === 'PENDING' && t.dueDate)
      .map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        priority: t.priority,
        category: t.category,
        dueDate: t.dueDate as string,
      }));
  }

  private attachments: AttachmentFile[] = [];
  private nextAttId = 1;
  async addAttachment(taskId: number, input: AddAttachmentInput) {
    if (!this.tasks.some((t) => t.id === taskId)) throw AppError.notFound('La tarea solicitada no existe.');
    const att: AttachmentFile = { id: this.nextAttId++, taskId, ...input, createdAt: new Date() };
    this.attachments.push(att);
    const { storedName: _s, ...rest } = att;
    void _s;
    return rest;
  }
  async getAttachments(taskId: number) {
    return this.attachments
      .filter((a) => a.taskId === taskId)
      .map(({ storedName: _s, ...rest }) => {
        void _s;
        return rest;
      });
  }
  async getAttachment(id: number) {
    return this.attachments.find((a) => a.id === id) ?? null;
  }
  async deleteAttachment(id: number) {
    const i = this.attachments.findIndex((a) => a.id === id);
    if (i === -1) throw AppError.notFound('El adjunto solicitado no existe.');
    const [removed] = this.attachments.splice(i, 1);
    return removed!.storedName;
  }
}

const authService = new AuthService({
  username: 'admin',
  password: 'admin123',
  jwtSecret: 'test-secret-with-at-least-thirty-two-characters',
  jwtExpiresIn: '1h',
  jwtIssuer: 'tasks-api',
});

function buildApp() {
  return createApp({
    corsOrigin: '*',
    authService,
    taskService: new TaskService(new InMemoryTaskRepository()),
    healthCheck: async () => true,
  });
}

describe('Tasks API', () => {
  let app: ReturnType<typeof buildApp>;
  let token: string;

  beforeEach(async () => {
    app = buildApp();
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
    token = res.body.data.token;
  });

  describe('POST /api/auth/login', () => {
    it('devuelve un JWT con credenciales válidas', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'admin123' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokenType).toBe('Bearer');
      expect(res.body.data.token.split('.')).toHaveLength(3);
    });

    it('responde 401 con credenciales inválidas', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('responde 400 si falta el password', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'admin' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details[0].field).toBe('body.password');
    });

    it('responde 400 ante JSON malformado', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"username":');
      expect(res.status).toBe(400);
    });
  });

  describe('authMiddleware', () => {
    it('responde 401 sin token', async () => {
      const res = await request(app).get('/api/tasks');
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Bearer');
    });

    it('responde 401 con token inválido', async () => {
      const res = await request(app).get('/api/tasks').set('Authorization', 'Bearer a.b.c');
      expect(res.status).toBe(401);
    });
  });

  describe('Tareas', () => {
    const auth = () => ({ Authorization: `Bearer ${token}` });

    it('crea una tarea (201) y la lista paginada', async () => {
      const created = await request(app)
        .post('/api/tasks')
        .set(auth())
        .send({ title: '  Nueva  ', description: 'Desc' });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ id: 1, title: 'Nueva', status: 'PENDING' });

      const list = await request(app).get('/api/tasks?page=1&pageSize=10').set(auth());
      expect(list.status).toBe(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.meta).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    });

    it('rechaza títulos vacíos o de más de 150 caracteres', async () => {
      const empty = await request(app).post('/api/tasks').set(auth()).send({ title: '   ' });
      expect(empty.status).toBe(400);
      const long = await request(app)
        .post('/api/tasks')
        .set(auth())
        .send({ title: 'x'.repeat(151) });
      expect(long.status).toBe(400);
    });

    it('rechaza campos desconocidos (validación estricta)', async () => {
      const res = await request(app).post('/api/tasks').set(auth()).send({ title: 'ok', hacker: true });
      expect(res.status).toBe(400);
    });

    it('filtra por estado y valida parámetros de query', async () => {
      await request(app).post('/api/tasks').set(auth()).send({ title: 'A' });
      await request(app).post('/api/tasks').set(auth()).send({ title: 'B' });
      await request(app).patch('/api/tasks/1/status').set(auth()).send({ status: 'COMPLETED' });

      const pending = await request(app).get('/api/tasks?status=PENDING').set(auth());
      expect(pending.body.meta.total).toBe(1);
      const all = await request(app).get('/api/tasks?status=ALL').set(auth());
      expect(all.body.meta.total).toBe(2);

      const bad = await request(app).get('/api/tasks?status=FOO&pageSize=500').set(auth());
      expect(bad.status).toBe(400);
      expect(bad.body.error.details).toHaveLength(2);
    });

    it('busca por título/descripción y ordena por fecha', async () => {
      await request(app).post('/api/tasks').set(auth()).send({ title: 'Comprar leche', description: 'supermercado' });
      await request(app).post('/api/tasks').set(auth()).send({ title: 'Pagar factura', description: 'luz y agua' });

      const byTitle = await request(app).get('/api/tasks?search=leche').set(auth());
      expect(byTitle.body.meta.total).toBe(1);
      expect(byTitle.body.data[0].title).toBe('Comprar leche');

      const byDesc = await request(app).get('/api/tasks?search=agua').set(auth());
      expect(byDesc.body.meta.total).toBe(1);
      expect(byDesc.body.data[0].title).toBe('Pagar factura');

      const oldest = await request(app).get('/api/tasks?sort=oldest').set(auth());
      expect(oldest.body.data[0].title).toBe('Comprar leche');

      const az = await request(app).get('/api/tasks?sort=title_asc').set(auth());
      expect(az.body.data.map((t: { title: string }) => t.title)).toEqual(['Comprar leche', 'Pagar factura']);
      const za = await request(app).get('/api/tasks?sort=title_desc').set(auth());
      expect(za.body.data.map((t: { title: string }) => t.title)).toEqual(['Pagar factura', 'Comprar leche']);

      const bad = await request(app).get('/api/tasks?sort=random').set(auth());
      expect(bad.status).toBe(400);
    });

    it('valida el rango de fechas (dateFrom > dateTo => 400)', async () => {
      const res = await request(app).get('/api/tasks?dateFrom=2026-10-01&dateTo=2026-09-01').set(auth());
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rechaza un formato de fecha inválido (400)', async () => {
      const res = await request(app).get('/api/tasks?dateFrom=01-10-2026').set(auth());
      expect(res.status).toBe(400);
    });

    it('sella completedAt al completar y lo limpia al reabrir', async () => {
      await request(app).post('/api/tasks').set(auth()).send({ title: 'Tarea con fecha' });
      const done = await request(app).patch('/api/tasks/1/status').set(auth()).send({ status: 'COMPLETED' });
      expect(done.body.data.completedAt).toBeTruthy();
      const reopened = await request(app).patch('/api/tasks/1/status').set(auth()).send({ status: 'PENDING' });
      expect(reopened.body.data.completedAt).toBeNull();
    });

    it('actualiza el estado (200) y responde 404 si no existe', async () => {
      await request(app).post('/api/tasks').set(auth()).send({ title: 'A' });
      const ok = await request(app).patch('/api/tasks/1/status').set(auth()).send({ status: 'completed' });
      expect(ok.status).toBe(200);
      expect(ok.body.data.status).toBe('COMPLETED');

      const missing = await request(app).patch('/api/tasks/999/status').set(auth()).send({ status: 'PENDING' });
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('NOT_FOUND');
    });

    it('responde 400 con id no numérico', async () => {
      const res = await request(app).patch('/api/tasks/abc/status').set(auth()).send({ status: 'PENDING' });
      expect(res.status).toBe(400);
    });

    it('edita una tarea (PUT) y responde 404 si no existe', async () => {
      await request(app).post('/api/tasks').set(auth()).send({ title: 'Original' });
      const ok = await request(app).put('/api/tasks/1').set(auth()).send({ title: 'Editada', description: 'nueva' });
      expect(ok.status).toBe(200);
      expect(ok.body.data).toMatchObject({ id: 1, title: 'Editada', description: 'nueva' });
      const missing = await request(app).put('/api/tasks/999').set(auth()).send({ title: 'X' });
      expect(missing.status).toBe(404);
    });

    it('elimina una tarea (DELETE 204) y responde 404 si no existe', async () => {
      await request(app).post('/api/tasks').set(auth()).send({ title: 'Borrar' });
      const ok = await request(app).delete('/api/tasks/1').set(auth());
      expect(ok.status).toBe(204);
      const list = await request(app).get('/api/tasks').set(auth());
      expect(list.body.meta.total).toBe(0);
      const missing = await request(app).delete('/api/tasks/1').set(auth());
      expect(missing.status).toBe(404);
    });

    it('acciones en lote: completar y eliminar varias (selección múltiple)', async () => {
      for (const t of ['A', 'B', 'C']) await request(app).post('/api/tasks').set(auth()).send({ title: t });
      const done = await request(app)
        .post('/api/tasks/bulk/status')
        .set(auth())
        .send({ ids: [1, 2], status: 'COMPLETED' });
      expect(done.status).toBe(200);
      expect(done.body.data.affected).toBe(2);
      const completed = await request(app).get('/api/tasks?status=COMPLETED').set(auth());
      expect(completed.body.meta.total).toBe(2);

      const del = await request(app)
        .post('/api/tasks/bulk/delete')
        .set(auth())
        .send({ ids: [1, 2, 3] });
      expect(del.status).toBe(200);
      expect(del.body.data.affected).toBe(3);
      const all = await request(app).get('/api/tasks').set(auth());
      expect(all.body.meta.total).toBe(0);
    });

    it('rechaza lote sin ids (400)', async () => {
      const res = await request(app).post('/api/tasks/bulk/delete').set(auth()).send({ ids: [] });
      expect(res.status).toBe(400);
    });

    it('crea con prioridad, categoría y vencimiento, y filtra por prioridad', async () => {
      const created = await request(app)
        .post('/api/tasks')
        .set(auth())
        .send({ title: 'Urgente', priority: 'high', category: 'Trabajo', dueDate: '2026-12-31' });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ priority: 'HIGH', category: 'Trabajo', dueDate: '2026-12-31' });

      await request(app).post('/api/tasks').set(auth()).send({ title: 'Normal' }); // priority MEDIUM por defecto
      const high = await request(app).get('/api/tasks?priority=HIGH').set(auth());
      expect(high.body.meta.total).toBe(1);
      expect(high.body.data[0].title).toBe('Urgente');

      const bad = await request(app).get('/api/tasks?priority=URGENTE').set(auth());
      expect(bad.status).toBe(400);
    });

    it('rechaza una fecha de vencimiento con formato inválido (400)', async () => {
      const res = await request(app).post('/api/tasks').set(auth()).send({ title: 'x', dueDate: '31-12-2026' });
      expect(res.status).toBe(400);
    });

    it('recurrencia: al completar una tarea que se repite, crea la siguiente', async () => {
      await request(app)
        .post('/api/tasks')
        .set(auth())
        .send({ title: 'Reporte semanal', recurrence: 'weekly', dueDate: '2026-10-05' });
      const before = await request(app).get('/api/tasks').set(auth());
      expect(before.body.meta.total).toBe(1);

      await request(app).patch('/api/tasks/1/status').set(auth()).send({ status: 'COMPLETED' });
      const after = await request(app).get('/api/tasks').set(auth());
      expect(after.body.meta.total).toBe(2); // se generó la siguiente ocurrencia
      const next = after.body.data.find((t: { status: string }) => t.status === 'PENDING');
      expect(next.dueDate).toBe('2026-10-12'); // +7 días
      expect(next.recurrence).toBe('WEEKLY');
    });

    it('calendario: devuelve un feed .ics con las tareas con vencimiento', async () => {
      await request(app).post('/api/tasks').set(auth()).send({ title: 'Con fecha', dueDate: '2026-11-20' });
      const res = await request(app).get('/api/tasks/calendar.ics').set(auth());
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain('SUMMARY:Con fecha');
      expect(res.text).toContain('DTSTART;VALUE=DATE:20261120');
    });

    it('notificaciones: cuenta vencidas y próximas a vencer', async () => {
      const ayer = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const mañana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      await request(app).post('/api/tasks').set(auth()).send({ title: 'Vencida', dueDate: ayer });
      await request(app).post('/api/tasks').set(auth()).send({ title: 'Próxima', dueDate: mañana });
      await request(app).post('/api/tasks').set(auth()).send({ title: 'Sin fecha' });

      const res = await request(app).get('/api/tasks/notifications?days=3').set(auth());
      expect(res.status).toBe(200);
      expect(res.body.data.overdue).toBe(1);
      expect(res.body.data.dueSoon).toBe(1);
      expect(res.body.data.items).toHaveLength(2);
    });

    it('devuelve estadísticas con totales y serie temporal', async () => {
      await request(app).post('/api/tasks').set(auth()).send({ title: 'A' });
      await request(app).post('/api/tasks').set(auth()).send({ title: 'B' });
      await request(app).patch('/api/tasks/1/status').set(auth()).send({ status: 'COMPLETED' });

      const res = await request(app).get('/api/tasks/stats?granularity=month').set(auth());
      expect(res.status).toBe(200);
      expect(res.body.data.granularity).toBe('month');
      expect(res.body.data.totals).toMatchObject({ total: 2, pending: 1, completed: 1, completionRate: 50 });
      expect(Array.isArray(res.body.data.series)).toBe(true);
      expect(res.body.data.series.length).toBeGreaterThan(0);
    });

    it('rechaza una granularidad inválida (400)', async () => {
      const res = await request(app).get('/api/tasks/stats?granularity=decada').set(auth());
      expect(res.status).toBe(400);
    });

    it('exige autenticación en /stats', async () => {
      const res = await request(app).get('/api/tasks/stats');
      expect(res.status).toBe(401);
    });
  });

  it('responde 404 con formato uniforme para rutas inexistentes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { status: 404, code: 'NOT_FOUND' }, path: '/api/nope' });
  });
});
