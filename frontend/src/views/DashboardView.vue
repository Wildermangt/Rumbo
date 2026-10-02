<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import DateRangeFilter from '@/components/DateRangeFilter.vue';
import PriorityChip from '@/components/PriorityChip.vue';
import StatCard from '@/components/StatCard.vue';
import StatusDonut from '@/components/StatusDonut.vue';
import TaskFormDialog from '@/components/TaskFormDialog.vue';
import TaskSkeleton from '@/components/TaskSkeleton.vue';
import TaskStatusChip from '@/components/TaskStatusChip.vue';
import { useNotifications } from '@/composables/useNotifications';
import { useNotifier } from '@/composables/useNotifier';
import { useTasks } from '@/composables/useTasks';
import { getErrorMessage } from '@/services/http';
import { googleCalendarUrl, tasksApi } from '@/services/tasks.api';
import {
  RECURRENCE_LABELS,
  TASK_CATEGORIES,
  type CreateTaskPayload,
  type PriorityFilter,
  type Task,
  type TaskFilter,
} from '@/types/task';

const notifier = useNotifier();
const notifs = useNotifications();
const {
  tasks,
  loading,
  saving,
  error,
  pagination,
  selectedIds,
  filterStatus,
  filterPriority,
  filterCategory,
  search,
  sort,
  dateFrom,
  dateTo,
  fetchTasks,
  setPage,
  createTask,
  editTask,
  updateStatus,
  deleteTask,
  bulkStatus,
  bulkDelete,
  clearSelection,
  isUpdating,
  clearSearch,
} = useTasks(10);

const sortOptions = [
  { value: 'newest', title: 'Más recientes', icon: 'mdi-sort-calendar-descending' },
  { value: 'oldest', title: 'Más antiguas', icon: 'mdi-sort-calendar-ascending' },
  { value: 'due_asc', title: 'Vence antes', icon: 'mdi-calendar-arrow-right' },
  { value: 'due_desc', title: 'Vence después', icon: 'mdi-calendar-arrow-left' },
  { value: 'priority', title: 'Prioridad: mayor a menor', icon: 'mdi-sort-descending' },
  { value: 'priority_asc', title: 'Prioridad: menor a mayor', icon: 'mdi-sort-ascending' },
  { value: 'title_asc', title: 'Título: A → Z', icon: 'mdi-sort-alphabetical-ascending' },
  { value: 'title_desc', title: 'Título: Z → A', icon: 'mdi-sort-alphabetical-descending' },
] as const;

const priorityFilters: { value: PriorityFilter; title: string }[] = [
  { value: 'ALL', title: 'Toda prioridad' },
  { value: 'HIGH', title: 'Alta' },
  { value: 'MEDIUM', title: 'Media' },
  { value: 'LOW', title: 'Baja' },
];
const categoryFilters = ['', ...TASK_CATEGORIES];

const dialogOpen = ref(false);
const editing = ref<Task | null>(null);

// Confirmaciones de borrado
const deleteTarget = ref<Task | null>(null);
const confirmBulkDelete = ref(false);

const filters: { value: TaskFilter; label: string; icon: string }[] = [
  { value: 'ALL', label: 'Todas', icon: 'mdi-format-list-bulleted' },
  { value: 'PENDING', label: 'Pendientes', icon: 'mdi-clock-outline' },
  { value: 'COMPLETED', label: 'Completadas', icon: 'mdi-check-circle-outline' },
];

const headers = [
  { title: 'ID', key: 'id', sortable: false, width: 56 },
  { title: 'Tarea', key: 'title', sortable: false },
  { title: 'Prioridad', key: 'priority', sortable: false, width: 120 },
  { title: 'Estado', key: 'status', sortable: false, width: 140 },
  { title: 'Vencimiento', key: 'dueDate', sortable: false, width: 132 },
  { title: 'Creación', key: 'createdAt', sortable: false, width: 132 },
  { title: 'Acciones', key: 'actions', sortable: false, align: 'end' as const, width: 210 },
];

const summary = reactive({ total: 0, pending: 0, completed: 0, loading: false });
const firstLoad = ref(true);

async function loadSummary(): Promise<void> {
  summary.loading = true;
  try {
    const [all, pending, completed] = await Promise.all([
      tasksApi.list({ status: 'ALL', page: 1, pageSize: 1 }),
      tasksApi.list({ status: 'PENDING', page: 1, pageSize: 1 }),
      tasksApi.list({ status: 'COMPLETED', page: 1, pageSize: 1 }),
    ]);
    summary.total = all.pagination.total;
    summary.pending = pending.pagination.total;
    summary.completed = completed.pagination.total;
  } catch {
    /* el error principal se muestra en la tabla */
  } finally {
    summary.loading = false;
  }
}

const dateFormatter = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
const formatDate = (iso: string): string => dateFormatter.format(new Date(iso));
const dueFormatter = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' });
const formatDue = (d: string): string => dueFormatter.format(new Date(`${d}T00:00:00`));

const todayStr = new Date().toISOString().slice(0, 10);
/** Estado del vencimiento de una tarea: vencida, próxima (<=3 días) o normal. */
function dueState(task: Task): 'overdue' | 'soon' | 'normal' | null {
  if (!task.dueDate || task.status === 'COMPLETED') return task.dueDate ? 'normal' : null;
  if (task.dueDate < todayStr) return 'overdue';
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  return task.dueDate <= soon ? 'soon' : 'normal';
}

const showSkeleton = computed(() => loading.value && tasks.value.length === 0);

function onOptionsChange(options: { page: number; itemsPerPage: number }): void {
  void setPage(options.page, options.itemsPerPage).finally(() => (firstLoad.value = false));
}

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}
function openEdit(task: Task): void {
  editing.value = task;
  dialogOpen.value = true;
}

// Crear o editar según el modo del diálogo.
async function onSubmitTask(payload: CreateTaskPayload): Promise<void> {
  try {
    if (editing.value) {
      const task = await editTask(editing.value.id, payload);
      notifier.success(`Tarea "${task.title}" actualizada`);
    } else {
      const task = await createTask(payload);
      notifier.success(`Tarea "${task.title}" creada correctamente`);
      void loadSummary();
      void notifs.load();
      void notifs.load();
    }
    dialogOpen.value = false;
    editing.value = null;
  } catch (err) {
    notifier.error(getErrorMessage(err));
  }
}

async function onDeleteConfirmed(): Promise<void> {
  const task = deleteTarget.value;
  if (!task) return;
  try {
    await deleteTask(task.id);
    notifier.success(`Tarea "${task.title}" eliminada`);
    void loadSummary();
    void notifs.load();
  } catch (err) {
    notifier.error(getErrorMessage(err));
  } finally {
    deleteTarget.value = null;
  }
}

// ----- Acciones en lote (selección múltiple) -----
async function onBulkStatus(status: 'COMPLETED' | 'PENDING'): Promise<void> {
  try {
    const n = await bulkStatus(status);
    notifier.success(status === 'COMPLETED' ? `${n} tarea(s) completadas` : `${n} tarea(s) reabiertas`);
    void loadSummary();
    void notifs.load();
  } catch (err) {
    notifier.error(getErrorMessage(err));
  }
}
async function onBulkDeleteConfirmed(): Promise<void> {
  try {
    const n = await bulkDelete();
    notifier.success(`${n} tarea(s) eliminadas`);
    void loadSummary();
    void notifs.load();
  } catch (err) {
    notifier.error(getErrorMessage(err));
  } finally {
    confirmBulkDelete.value = false;
  }
}

async function onToggle(task: Task): Promise<void> {
  const next = task.status === 'PENDING' ? 'COMPLETED' : 'PENDING';
  try {
    await updateStatus(task.id, next);
    notifier.success(next === 'COMPLETED' ? `"${task.title}" marcada como completada` : `"${task.title}" reabierta`);
    void loadSummary();
    void notifs.load();
  } catch (err) {
    notifier.error(getErrorMessage(err));
  }
}

async function onExportCalendar(): Promise<void> {
  try {
    await tasksApi.downloadCalendar();
    notifier.success('Calendario .ics descargado. Impórtalo en tu correo o Google Calendar.');
  } catch (err) {
    notifier.error(getErrorMessage(err));
  }
}

onMounted(loadSummary);
</script>

<template>
  <v-main>
    <AppHeader />

    <div class="page">
      <!-- Resumen: KPIs + donut -->
      <section class="summary">
        <div v-reveal="0" class="summary__cards">
          <StatCard
            label="Total de tareas"
            :value="summary.total"
            icon="mdi-format-list-checks"
            tone="accent"
            :loading="summary.loading"
          />
          <StatCard
            label="Pendientes"
            :value="summary.pending"
            icon="mdi-clock-outline"
            tone="warning"
            :loading="summary.loading"
          />
          <StatCard
            label="Completadas"
            :value="summary.completed"
            icon="mdi-check-circle-outline"
            tone="success"
            :loading="summary.loading"
          />
        </div>
        <div v-reveal="120" class="summary__chart">
          <StatusDonut :pending="summary.pending" :completed="summary.completed" :loading="summary.loading" />
        </div>
      </section>

      <!-- Panel de tareas -->
      <section v-reveal="180" class="panel glass">
        <div class="panel__head">
          <div class="panel__titlerow">
            <h2 class="panel__title">Mis tareas</h2>
            <div class="panel__titleactions">
              <v-btn
                variant="tonal"
                prepend-icon="mdi-calendar-export"
                data-testid="export-calendar"
                @click="onExportCalendar"
              >
                Calendario
              </v-btn>
              <v-btn class="btn-accent" prepend-icon="mdi-plus" data-testid="new-task" @click="openCreate">
                Nueva tarea
              </v-btn>
            </div>
          </div>

          <div class="panel__tools">
            <!-- Cuadro de búsqueda (server-side, con debounce) -->
            <label class="search">
              <v-icon icon="mdi-magnify" size="20" class="search__icon" />
              <input
                v-model="search"
                type="search"
                class="search__input"
                placeholder="Buscar por título o descripción…"
                aria-label="Buscar tareas"
                data-testid="search-input"
              />
              <button
                v-if="search"
                class="search__clear"
                aria-label="Limpiar búsqueda"
                data-testid="search-clear"
                @click="clearSearch"
              >
                <v-icon icon="mdi-close-circle" size="18" />
              </button>
            </label>

            <!-- Filtro por estado -->
            <div class="seg">
              <button
                v-for="f in filters"
                :key="f.value"
                class="seg__btn"
                :class="{ active: filterStatus === f.value }"
                :data-testid="f.value === 'ALL' ? 'status-filter' : undefined"
                @click="filterStatus = f.value"
              >
                <v-icon :icon="f.icon" size="17" /> <span class="seg__label">{{ f.label }}</span>
              </button>
            </div>

            <!-- Filtro por prioridad -->
            <v-select
              v-model="filterPriority"
              :items="priorityFilters"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              hide-details
              class="mini-select"
              prepend-inner-icon="mdi-flag-outline"
              data-testid="priority-filter"
            />

            <!-- Filtro por categoría -->
            <v-select
              v-model="filterCategory"
              :items="categoryFilters"
              variant="outlined"
              density="comfortable"
              hide-details
              class="mini-select"
              prepend-inner-icon="mdi-tag-outline"
              placeholder="Categoría"
              data-testid="category-filter"
            >
              <template #item="{ props, item }">
                <v-list-item v-bind="props" :title="item.raw || 'Toda categoría'" />
              </template>
              <template #selection="{ item }">{{ item.raw || 'Categoría' }}</template>
            </v-select>

            <!-- Filtro de orden -->
            <v-select
              v-model="sort"
              :items="sortOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              hide-details
              class="sort-select"
              prepend-inner-icon="mdi-sort"
              data-testid="sort-select"
            />

            <!-- Filtro por fecha: botón que abre opciones rápidas y un calendario -->
            <DateRangeFilter v-model:from="dateFrom" v-model:to="dateTo" />

            <button class="icon-btn" aria-label="Recargar" :class="{ spin: loading }" @click="fetchTasks">
              <v-icon icon="mdi-refresh" />
            </button>
          </div>
        </div>

        <transition name="fade">
          <div v-if="error" class="panel__error" data-testid="tasks-error">
            <v-icon icon="mdi-alert-circle" size="18" />
            <span>{{ error }}</span>
            <v-btn size="small" variant="tonal" @click="fetchTasks">Reintentar</v-btn>
          </div>
        </transition>

        <!-- Barra de acciones en lote (aparece al seleccionar) -->
        <transition name="fade">
          <div v-if="selectedIds.length" class="bulkbar" data-testid="bulkbar">
            <span class="bulkbar__count">{{ selectedIds.length }} seleccionada(s)</span>
            <div class="bulkbar__actions">
              <v-btn
                size="small"
                variant="flat"
                color="success"
                prepend-icon="mdi-check-all"
                :loading="saving"
                @click="onBulkStatus('COMPLETED')"
              >
                Finalizar
              </v-btn>
              <v-btn
                size="small"
                variant="flat"
                color="warning"
                prepend-icon="mdi-restore"
                :loading="saving"
                @click="onBulkStatus('PENDING')"
              >
                Retomar
              </v-btn>
              <v-btn
                size="small"
                variant="flat"
                color="error"
                prepend-icon="mdi-delete"
                data-testid="bulk-delete"
                :loading="saving"
                @click="confirmBulkDelete = true"
              >
                Eliminar
              </v-btn>
              <v-btn size="small" variant="text" @click="clearSelection">Cancelar</v-btn>
            </div>
          </div>
        </transition>

        <TaskSkeleton v-if="showSkeleton" :rows="pagination.pageSize > 10 ? 8 : 6" />

        <v-data-table-server
          v-show="!showSkeleton"
          v-model="selectedIds"
          class="tasks-table"
          :headers="headers"
          :items="tasks"
          :items-length="pagination.total"
          :loading="loading && !showSkeleton"
          :page="pagination.page"
          :items-per-page="pagination.pageSize"
          :items-per-page-options="[5, 10, 20, 50]"
          item-value="id"
          show-select
          loading-text="Cargando tareas..."
          no-data-text="No hay tareas para este filtro"
          hover
          data-testid="tasks-table"
          @update:options="onOptionsChange"
        >
          <template #[`item.id`]="{ item }">
            <span class="cell-id">#{{ item.id }}</span>
          </template>
          <template #[`item.title`]="{ item }">
            <div class="cell-task">
              <span class="cell-title">
                {{ item.title }}
                <v-icon
                  v-if="item.recurrence !== 'NONE'"
                  icon="mdi-repeat"
                  size="14"
                  class="rec-ico"
                  :title="`Se repite: ${RECURRENCE_LABELS[item.recurrence]}`"
                />
              </span>
              <div class="cell-meta">
                <span v-if="item.category" class="cat-chip">{{ item.category }}</span>
                <span v-if="item.description" class="cell-desc" :title="item.description">{{ item.description }}</span>
              </div>
            </div>
          </template>
          <template #[`item.priority`]="{ item }">
            <PriorityChip :priority="item.priority" />
          </template>
          <template #[`item.status`]="{ item }">
            <transition name="pop" mode="out-in">
              <div :key="item.status" class="cell-status">
                <TaskStatusChip :status="item.status" />
                <span v-if="item.completedAt" class="cell-sub">✓ {{ formatDue(item.completedAt.slice(0, 10)) }}</span>
              </div>
            </transition>
          </template>
          <template #[`item.dueDate`]="{ item }">
            <span v-if="item.dueDate" class="cell-due" :class="dueState(item)">
              <v-icon
                :icon="dueState(item) === 'overdue' ? 'mdi-calendar-alert' : 'mdi-calendar'"
                size="14"
                class="cell-date__ico"
              />
              {{ formatDue(item.dueDate) }}
            </span>
            <span v-else class="cell-date cell-date--empty">—</span>
          </template>
          <template #[`item.createdAt`]="{ item }">
            <span class="cell-date">{{ formatDate(item.createdAt) }}</span>
          </template>
          <template #[`item.actions`]="{ item }">
            <div class="rowactions">
              <button
                class="toggle"
                :class="item.status === 'PENDING' ? 'to-done' : 'to-open'"
                :disabled="isUpdating(item.id)"
                :data-testid="`toggle-${item.id}`"
                :title="
                  item.status === 'PENDING'
                    ? 'Marcar esta tarea como finalizada'
                    : 'Retomar: vuelve a pendiente y borra la fecha de culminación'
                "
                @click="onToggle(item)"
              >
                <v-progress-circular v-if="isUpdating(item.id)" indeterminate size="15" width="2" />
                <template v-else>
                  <v-icon :icon="item.status === 'PENDING' ? 'mdi-check' : 'mdi-restore'" size="16" />
                  {{ item.status === 'PENDING' ? 'Finalizada' : 'Retomar' }}
                </template>
              </button>
              <a
                v-if="item.dueDate"
                class="iconact cal"
                title="Añadir a Google Calendar"
                :href="googleCalendarUrl({ title: item.title, description: item.description, dueDate: item.dueDate })"
                target="_blank"
                rel="noopener"
                :data-testid="`gcal-${item.id}`"
              >
                <v-icon icon="mdi-calendar-plus" size="18" />
              </a>
              <button class="iconact edit" title="Editar" :data-testid="`edit-${item.id}`" @click="openEdit(item)">
                <v-icon icon="mdi-pencil-outline" size="18" />
              </button>
              <button
                class="iconact del"
                title="Eliminar"
                :data-testid="`delete-${item.id}`"
                @click="deleteTarget = item"
              >
                <v-icon icon="mdi-delete-outline" size="18" />
              </button>
            </div>
          </template>
        </v-data-table-server>
      </section>
    </div>
  </v-main>

  <TaskFormDialog v-model="dialogOpen" :loading="saving" :task="editing" @submit="onSubmitTask" />

  <!-- Confirmar borrado de una tarea -->
  <v-dialog :model-value="!!deleteTarget" max-width="440" @update:model-value="deleteTarget = null">
    <div class="confirm glass">
      <div class="confirm__icon"><v-icon icon="mdi-delete-alert-outline" /></div>
      <h3 class="confirm__title">Eliminar tarea</h3>
      <p class="confirm__text">
        ¿Seguro que quieres eliminar <b>“{{ deleteTarget?.title }}”</b>? Esta acción no se puede deshacer.
      </p>
      <div class="confirm__actions">
        <v-btn variant="text" :disabled="isUpdating(deleteTarget?.id ?? -1)" @click="deleteTarget = null"
          >Cancelar</v-btn
        >
        <v-btn
          color="error"
          variant="flat"
          prepend-icon="mdi-delete"
          :loading="isUpdating(deleteTarget?.id ?? -1)"
          data-testid="confirm-delete"
          @click="onDeleteConfirmed"
        >
          Eliminar
        </v-btn>
      </div>
    </div>
  </v-dialog>

  <!-- Confirmar borrado en lote -->
  <v-dialog v-model="confirmBulkDelete" max-width="440">
    <div class="confirm glass">
      <div class="confirm__icon"><v-icon icon="mdi-delete-sweep-outline" /></div>
      <h3 class="confirm__title">Eliminar seleccionadas</h3>
      <p class="confirm__text">
        Se eliminarán <b>{{ selectedIds.length }}</b> tarea(s). Esta acción no se puede deshacer.
      </p>
      <div class="confirm__actions">
        <v-btn variant="text" :disabled="saving" @click="confirmBulkDelete = false">Cancelar</v-btn>
        <v-btn
          color="error"
          variant="flat"
          prepend-icon="mdi-delete"
          :loading="saving"
          data-testid="confirm-bulk-delete"
          @click="onBulkDeleteConfirmed"
        >
          Eliminar {{ selectedIds.length }}
        </v-btn>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.icon-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--surface-border);
  color: var(--text);
  cursor: pointer;
  transition:
    background var(--dur-1),
    color var(--dur-1),
    transform var(--dur-1);
}
.icon-btn:hover {
  background: var(--glass-highlight);
  color: var(--accent-1);
}
.icon-btn.spin :deep(.v-icon) {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Contenedor estándar: ancho máximo centrado, gutters simétricos y una
   separación vertical uniforme entre secciones (sin márgenes sueltos). */
.page {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--sp-6) var(--sp-6) var(--sp-8);
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}

.summary {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--sp-5);
}
.summary__cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-5);
}
@media (max-width: 1100px) {
  .summary {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 760px) {
  .summary__cards {
    grid-template-columns: 1fr;
  }
}

.panel {
  padding: 0;
  overflow: hidden;
}
.panel__head {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  padding: var(--sp-5) var(--sp-6);
  border-bottom: 1px solid var(--surface-border);
}
.panel__titlerow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}
.panel__title {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--text-strong);
  letter-spacing: var(--tracking-tight);
}
.panel__tools {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
}

/* Cuadro de búsqueda */
.search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 260px;
  min-width: 220px;
  padding: 0 12px;
  height: 42px;
  border-radius: var(--radius-md);
  background: var(--glass-highlight);
  border: 1px solid var(--surface-border);
  transition:
    border-color var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2) var(--ease-out);
}
.search:focus-within {
  border-color: var(--accent-1);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-1) 22%, transparent);
}
.search__icon {
  color: var(--text-muted);
  flex-shrink: 0;
}
.search__input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-strong);
  font-size: var(--fs-sm);
  font-family: inherit;
}
.search__input::placeholder {
  color: var(--text-muted);
}
.search__input::-webkit-search-cancel-button {
  display: none;
}
.search__clear {
  display: grid;
  place-items: center;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  transition: color var(--dur-1);
}
.search__clear:hover {
  color: var(--accent-1);
}

.sort-select {
  max-width: 190px;
}
.mini-select {
  max-width: 160px;
}
:deep(.sort-select .v-field),
:deep(.mini-select .v-field) {
  border-radius: var(--radius-md);
  background: var(--glass-highlight);
}

@media (max-width: 760px) {
  .search {
    flex-basis: 100%;
  }
  .sort-select,
  .mini-select {
    max-width: none;
    flex: 1;
  }
}

/* Celda de tarea (título + categoría + descripción) */
.cell-task {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0;
}
.cell-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cat-chip {
  flex-shrink: 0;
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--accent-1);
  background: color-mix(in srgb, var(--accent-1) 11%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent-1) 24%, transparent);
  border-radius: var(--radius-full);
  padding: 1px 8px;
}
.cell-status {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
}
.cell-sub {
  font-size: var(--fs-xs);
  color: var(--success);
}
.cell-due {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--fs-sm);
  white-space: nowrap;
  color: var(--text-muted);
}
.cell-due.overdue {
  color: #dc2626;
  font-weight: 600;
}
.cell-due.soon {
  color: #b45309;
  font-weight: 600;
}

.seg {
  display: inline-flex;
  padding: 4px;
  gap: 2px;
  background: var(--glass-highlight);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
}
.seg__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 13px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  font-weight: 600;
  transition:
    color var(--dur-1),
    background var(--dur-2) var(--ease-out),
    box-shadow var(--dur-2);
}
.seg__btn:hover {
  color: var(--text);
}
.seg__btn.active {
  color: #fff;
  background: var(--gradient-accent);
  box-shadow: var(--shadow-accent);
}
@media (max-width: 560px) {
  .seg__label {
    display: none;
  }
}

.panel__error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 var(--sp-5) var(--sp-4);
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, #dc2626 10%, transparent);
  border: 1px solid color-mix(in srgb, #dc2626 28%, transparent);
  color: #ef4444;
  font-size: var(--fs-sm);
}
.panel__error span {
  flex: 1;
}

.cell-id {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.cell-title {
  font-weight: 600;
  color: var(--text-strong);
}
.cell-desc {
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  max-width: 420px;
  font-size: var(--fs-sm);
}
.cell-date {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}
.cell-date__ico {
  opacity: 0.7;
}
.cell-date--done {
  color: var(--success);
}
.cell-date--empty {
  color: var(--surface-border-strong);
}

.toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 102px;
  padding: 7px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition:
    transform var(--dur-1) var(--ease-out),
    filter var(--dur-1),
    background var(--dur-1);
}
.toggle:disabled {
  opacity: 0.7;
  cursor: default;
}
.toggle:not(:disabled):hover {
  transform: translateY(-1px);
  filter: brightness(1.05);
}
.toggle:not(:disabled):active {
  transform: scale(0.97);
}
.to-done {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
  border-color: color-mix(in srgb, var(--success) 32%, transparent);
}
.to-open {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
  border-color: color-mix(in srgb, var(--warning) 32%, transparent);
}
/* En oscuro, los tintes a baja opacidad se ven turbios: subimos el contraste. */
.v-theme--dark .to-done {
  color: #6ee7a0;
  background: color-mix(in srgb, #4ade80 20%, transparent);
  border-color: color-mix(in srgb, #4ade80 42%, transparent);
}
.v-theme--dark .to-open {
  color: #fcd34d;
  background: color-mix(in srgb, #fbbf24 20%, transparent);
  border-color: color-mix(in srgb, #fbbf24 42%, transparent);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-2);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* Acciones por fila (completar/retomar + editar + eliminar) */
.rowactions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}
.iconact {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background var(--dur-1),
    color var(--dur-1),
    border-color var(--dur-1);
}
.iconact.edit:hover {
  color: var(--accent-1);
  background: color-mix(in srgb, var(--accent-1) 10%, transparent);
}
.iconact.del:hover {
  color: #dc2626;
  background: color-mix(in srgb, #dc2626 10%, transparent);
}
.iconact.cal {
  text-decoration: none;
}
.iconact.cal:hover {
  color: var(--accent-1);
  background: color-mix(in srgb, var(--accent-1) 10%, transparent);
}
.rec-ico {
  color: var(--accent-1);
  margin-left: 4px;
  vertical-align: middle;
}
.panel__titleactions {
  display: flex;
  gap: var(--sp-2);
}

/* Barra de acciones en lote */
.bulkbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin: var(--sp-4) var(--sp-6) 0;
  padding: 10px 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent-1) 9%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--accent-1) 28%, transparent);
}
.bulkbar__count {
  font-weight: 700;
  color: var(--accent-1);
  font-size: var(--fs-sm);
}
.bulkbar__actions {
  display: flex;
  gap: var(--sp-2);
  flex-wrap: wrap;
}

/* Diálogo de confirmación */
.confirm {
  padding: var(--sp-6);
  text-align: center;
}
.confirm__icon {
  width: 52px;
  height: 52px;
  margin: 0 auto var(--sp-3);
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, #dc2626 12%, transparent);
  color: #dc2626;
}
.confirm__title {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--text-strong);
}
.confirm__text {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  margin: var(--sp-2) 0 var(--sp-5);
}
.confirm__actions {
  display: flex;
  justify-content: center;
  gap: var(--sp-2);
}
</style>

<style>
/* Integración de la data-table de Vuetify con el sistema glass */
.tasks-table.v-data-table {
  background: transparent !important;
}
.tasks-table .v-table__wrapper > table > thead > tr > th {
  background: var(--glass-highlight) !important;
  color: var(--text-muted) !important;
  font-weight: 700 !important;
  font-size: var(--fs-xs) !important;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  height: 44px !important;
  padding-top: 8px !important;
  padding-bottom: 8px !important;
  border-bottom: 1px solid var(--surface-border) !important;
}
/* Relleno horizontal compacto para que las 8 columnas quepan sin recortes
   (Vuetify usa 16px por lado por defecto). */
.tasks-table .v-table__wrapper > table > thead > tr > th,
.tasks-table .v-table__wrapper > table > tbody > tr > td {
  padding-left: 10px !important;
  padding-right: 10px !important;
}
/* Gutter lateral de la tabla, alineado con el relleno de la cabecera del panel. */
.tasks-table .v-table__wrapper > table > thead > tr > th:first-child,
.tasks-table .v-table__wrapper > table > tbody > tr > td:first-child {
  padding-left: var(--sp-5) !important;
}
.tasks-table .v-table__wrapper > table > thead > tr > th:last-child,
.tasks-table .v-table__wrapper > table > tbody > tr > td:last-child {
  padding-right: var(--sp-4) !important;
}
.tasks-table .v-table__wrapper > table > tbody > tr > td {
  border-bottom: 1px solid var(--surface-border) !important;
  padding-top: 12px !important;
  padding-bottom: 12px !important;
  transition: background var(--dur-1) var(--ease-out);
}
.tasks-table .v-table__wrapper > table > tbody > tr:hover > td {
  background: var(--glass-highlight) !important;
}
.tasks-table .v-data-table-footer {
  border-top: 1px solid var(--surface-border);
  color: var(--text-muted);
}
</style>
