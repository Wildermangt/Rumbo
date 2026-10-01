import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type {
  CreateTaskInput,
  FindTasksParams,
  FindTasksResult,
  RawStats,
  TaskRepository,
} from '../src/repositories/task.repository';
import type { StatsGranularity } from '../src/types/task';
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

  async create({ title, description }: CreateTaskInput): Promise<Task> {
    const task: Task = {
      id: this.nextId++,
      title,
      description,
      status: 'PENDING',
      createdAt: new Date(),
      completedAt: null,
    };
    this.tasks.push(task);
    return task;
  }

  async updateStatus(id: number, status: TaskStatus): Promise<Task> {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) throw AppError.notFound('La tarea solicitada no existe.');
    task.status = status;
    task.completedAt = status === 'COMPLETED' ? new Date() : null;
    return task;
  }

  async getStats(_granularity: StatsGranularity): Promise<RawStats> {
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
