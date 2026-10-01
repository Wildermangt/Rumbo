<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import DateRangeFilter from '@/components/DateRangeFilter.vue';
import StatCard from '@/components/StatCard.vue';
import StatusDonut from '@/components/StatusDonut.vue';
import TaskFormDialog from '@/components/TaskFormDialog.vue';
import TaskSkeleton from '@/components/TaskSkeleton.vue';
import TaskStatusChip from '@/components/TaskStatusChip.vue';
import { useNotifier } from '@/composables/useNotifier';
import { useTasks } from '@/composables/useTasks';
import { getErrorMessage } from '@/services/http';
import { tasksApi } from '@/services/tasks.api';
import type { CreateTaskPayload, Task, TaskFilter } from '@/types/task';

const notifier = useNotifier();
const {
  tasks,
  loading,
  saving,
  error,
  pagination,
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
} = useTasks(10);

const sortOptions = [
  { value: 'newest', title: 'Más recientes', icon: 'mdi-sort-calendar-descending' },
  { value: 'oldest', title: 'Más antiguas', icon: 'mdi-sort-calendar-ascending' },
  { value: 'title_asc', title: 'Título: A → Z', icon: 'mdi-sort-alphabetical-ascending' },
  { value: 'title_desc', title: 'Título: Z → A', icon: 'mdi-sort-alphabetical-descending' },
] as const;

const dialogOpen = ref(false);

const filters: { value: TaskFilter; label: string; icon: string }[] = [
  { value: 'ALL', label: 'Todas', icon: 'mdi-format-list-bulleted' },
  { value: 'PENDING', label: 'Pendientes', icon: 'mdi-clock-outline' },
  { value: 'COMPLETED', label: 'Completadas', icon: 'mdi-check-circle-outline' },
];

const headers = [
  { title: 'ID', key: 'id', sortable: false, width: 64 },
  { title: 'Título', key: 'title', sortable: false },
  { title: 'Descripción', key: 'description', sortable: false },
  { title: 'Estado', key: 'status', sortable: false, width: 140 },
  { title: 'Creación', key: 'createdAt', sortable: false, width: 160 },
  { title: 'Culminación', key: 'completedAt', sortable: false, width: 160 },
  { title: 'Acción', key: 'actions', sortable: false, align: 'end' as const, width: 150 },
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

const showSkeleton = computed(() => loading.value && tasks.value.length === 0);

function onOptionsChange(options: { page: number; itemsPerPage: number }): void {
  void setPage(options.page, options.itemsPerPage).finally(() => (firstLoad.value = false));
}

async function onCreate(payload: CreateTaskPayload): Promise<void> {
  try {
    const task = await createTask(payload);
    dialogOpen.value = false;
    notifier.success(`Tarea "${task.title}" creada correctamente`);
    void loadSummary();
  } catch (err) {
    notifier.error(getErrorMessage(err));
  }
}

async function onToggle(task: Task): Promise<void> {
  const next = task.status === 'PENDING' ? 'COMPLETED' : 'PENDING';
  try {
    await updateStatus(task.id, next);
    notifier.success(next === 'COMPLETED' ? `"${task.title}" marcada como completada` : `"${task.title}" reabierta`);
    void loadSummary();
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
            <v-btn class="btn-accent" prepend-icon="mdi-plus" data-testid="new-task" @click="dialogOpen = true">
              Nueva tarea
            </v-btn>
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

        <TaskSkeleton v-if="showSkeleton" :rows="pagination.pageSize > 10 ? 8 : 6" />

        <v-data-table-server
          v-show="!showSkeleton"
          class="tasks-table"
          :headers="headers"
          :items="tasks"
          :items-length="pagination.total"
          :loading="loading && !showSkeleton"
          :page="pagination.page"
          :items-per-page="pagination.pageSize"
          :items-per-page-options="[5, 10, 20, 50]"
          item-value="id"
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
            <span class="cell-title">{{ item.title }}</span>
          </template>
          <template #[`item.description`]="{ item }">
            <span class="cell-desc" :title="item.description ?? ''">{{ item.description || '—' }}</span>
          </template>
          <template #[`item.status`]="{ item }">
            <transition name="pop" mode="out-in">
              <TaskStatusChip :key="item.status" :status="item.status" />
            </transition>
          </template>
          <template #[`item.createdAt`]="{ item }">
            <span class="cell-date">
              <v-icon icon="mdi-calendar-plus" size="14" class="cell-date__ico" />
              {{ formatDate(item.createdAt) }}
            </span>
          </template>
          <template #[`item.completedAt`]="{ item }">
            <span v-if="item.completedAt" class="cell-date cell-date--done">
              <v-icon icon="mdi-calendar-check" size="14" class="cell-date__ico" />
              {{ formatDate(item.completedAt) }}
            </span>
            <span v-else class="cell-date cell-date--empty">—</span>
          </template>
          <template #[`item.actions`]="{ item }">
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
          </template>
        </v-data-table-server>
      </section>
    </div>
  </v-main>

  <TaskFormDialog v-model="dialogOpen" :loading="saving" @submit="onCreate" />
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

.page {
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--sp-5) var(--sp-5) var(--sp-8);
}

.summary {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--sp-4);
  margin-bottom: var(--sp-5);
}
.summary__cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--sp-4);
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
  padding: var(--sp-5);
}
.panel__titlerow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}
.panel__title {
  font-size: var(--fs-xl);
  font-weight: 700;
  color: var(--text-strong);
  letter-spacing: var(--tracking-tight);
}
.panel__tools {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
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
  height: 46px;
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
:deep(.sort-select .v-field) {
  border-radius: var(--radius-md);
  background: var(--glass-highlight);
}

@media (max-width: 760px) {
  .search {
    flex-basis: 100%;
  }
  .sort-select {
    max-width: none;
    flex: 1;
  }
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
  min-width: 118px;
  padding: 7px 14px;
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
  background: color-mix(in srgb, var(--success) 13%, transparent);
  border-color: color-mix(in srgb, var(--success) 28%, transparent);
}
.to-open {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 13%, transparent);
  border-color: color-mix(in srgb, var(--warning) 28%, transparent);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--dur-2);
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
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
  border-bottom: 1px solid var(--surface-border) !important;
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
