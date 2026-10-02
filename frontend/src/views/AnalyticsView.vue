<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import StatCard from '@/components/StatCard.vue';
import StatusDonut from '@/components/StatusDonut.vue';
import TrendChart from '@/components/TrendChart.vue';
import { useNotifier } from '@/composables/useNotifier';
import { getErrorMessage } from '@/services/http';
import { tasksApi } from '@/services/tasks.api';
import type { StatsGranularity, StatsRange, TaskStats } from '@/types/task';

const notifier = useNotifier();

const granularities: { value: StatsGranularity; label: string; icon: string }[] = [
  { value: 'week', label: 'Semana', icon: 'mdi-calendar-week' },
  { value: 'month', label: 'Mes', icon: 'mdi-calendar-month' },
  { value: 'year', label: 'Año', icon: 'mdi-calendar-blank' },
];

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const granularity = ref<StatsGranularity>('month');
/** Periodo seleccionado: 'all' = todo el historial. */
const period = ref<string>('all');
const stats = ref<TaskStats | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
let controller: AbortController | null = null;

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function mondayOf(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
}

/** Opciones del selector de periodo, según la granularidad elegida. */
const periodOptions = computed<{ value: string; title: string }[]>(() => {
  const now = new Date();
  if (granularity.value === 'year') {
    const y = now.getUTCFullYear();
    return [
      { value: 'all', title: 'Todos los años' },
      ...Array.from({ length: 3 }, (_, i) => ({ value: String(y - i), title: String(y - i) })),
    ];
  }
  if (granularity.value === 'month') {
    const opts = [{ value: 'all', title: 'Todos los meses' }];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      opts.push({
        value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
        title: `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      });
    }
    return opts;
  }
  const opts = [{ value: 'all', title: 'Todas las semanas' }];
  let mon = mondayOf(now);
  for (let i = 0; i < 12; i++) {
    opts.push({ value: ymd(mon), title: `Semana del ${mon.getUTCDate()} ${MONTHS[mon.getUTCMonth()]}` });
    mon = new Date(Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() - 7));
  }
  return opts;
});

/** Rango (from/to/bucket) que corresponde al periodo seleccionado. */
const selectedRange = computed<StatsRange | undefined>(() => {
  if (period.value === 'all') return undefined;
  if (granularity.value === 'year') {
    return { from: `${period.value}-01-01`, to: `${period.value}-12-31`, bucket: 'month' };
  }
  if (granularity.value === 'month') {
    const [y, m] = period.value.split('-').map(Number);
    return { from: ymd(new Date(Date.UTC(y!, m! - 1, 1))), to: ymd(new Date(Date.UTC(y!, m!, 0))), bucket: 'day' };
  }
  const [y, m, d] = period.value.split('-').map(Number);
  return {
    from: ymd(new Date(Date.UTC(y!, m! - 1, d!))),
    to: ymd(new Date(Date.UTC(y!, m! - 1, d! + 6))),
    bucket: 'day',
  };
});

const periodLabel = computed(() => periodOptions.value.find((o) => o.value === period.value)?.title ?? '');

async function load(): Promise<void> {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  error.value = null;
  try {
    stats.value = await tasksApi.stats(granularity.value, selectedRange.value, current.signal);
  } catch (err) {
    if (current.signal.aborted) return;
    error.value = getErrorMessage(err);
    notifier.error(error.value);
  } finally {
    if (controller === current) loading.value = false;
  }
}

const granularityNoun: Record<StatsGranularity, string> = { week: 'semana', month: 'mes', year: 'año' };
const subtitle = computed(() =>
  period.value === 'all'
    ? `Métricas y evolución de tus tareas por ${granularityNoun[granularity.value]}.`
    : `Métricas de ${periodLabel.value.toLowerCase()}.`,
);

// Al cambiar la granularidad se reinicia el periodo a "todos"; una sola recarga.
watch(granularity, () => {
  period.value = 'all';
});
watch([granularity, period], load);
onMounted(load);
</script>

<template>
  <v-main>
    <AppHeader />

    <div class="page">
      <!-- Encabezado + selector de granularidad y periodo -->
      <div v-reveal="0" class="head">
        <div>
          <h1 class="head__title">Análisis general</h1>
          <p class="head__sub">{{ subtitle }}</p>
        </div>
        <div class="head__controls">
          <div class="seg" role="tablist" aria-label="Granularidad">
            <button
              v-for="g in granularities"
              :key="g.value"
              class="seg__btn"
              :class="{ active: granularity === g.value }"
              :data-testid="`gran-${g.value}`"
              role="tab"
              :aria-selected="granularity === g.value"
              @click="granularity = g.value"
            >
              <v-icon :icon="g.icon" size="17" /> <span>{{ g.label }}</span>
            </button>
          </div>
          <v-select
            v-model="period"
            :items="periodOptions"
            item-title="title"
            item-value="value"
            density="comfortable"
            variant="outlined"
            hide-details
            prepend-inner-icon="mdi-calendar-search"
            class="period-select"
            data-testid="period-select"
          />
        </div>
      </div>

      <!-- KPIs -->
      <div v-reveal="60" class="kpis">
        <StatCard
          label="Total de tareas"
          :value="stats?.totals.total ?? 0"
          icon="mdi-format-list-checks"
          tone="accent"
          :loading="loading"
        />
        <StatCard
          label="Completadas"
          :value="stats?.totals.completed ?? 0"
          icon="mdi-check-circle-outline"
          tone="success"
          :loading="loading"
        />
        <StatCard
          label="Tasa de avance"
          :value="stats?.totals.completionRate ?? 0"
          suffix="%"
          icon="mdi-progress-check"
          tone="accent"
          :loading="loading"
        />
        <StatCard
          label="Tiempo medio"
          :value="stats?.totals.avgCompletionHours ?? 0"
          suffix=" h"
          :empty="!loading && stats?.totals.avgCompletionHours == null"
          icon="mdi-timer-sand"
          tone="warning"
          :loading="loading"
        />
      </div>

      <!-- Tendencia + distribución -->
      <div class="grid">
        <section v-reveal="120" class="card glass">
          <div class="card__head">
            <h2 class="card__title">Creadas vs. completadas</h2>
            <span class="card__hint">por {{ granularityNoun[granularity] }}</span>
          </div>
          <TrendChart :series="stats?.series ?? []" :loading="loading" />
        </section>

        <aside v-reveal="180" class="side">
          <StatusDonut
            :pending="stats?.totals.pending ?? 0"
            :completed="stats?.totals.completed ?? 0"
            :loading="loading"
          />
        </aside>
      </div>
    </div>
  </v-main>
</template>

<style scoped>
.page {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--sp-6) var(--sp-6) var(--sp-8);
  display: flex;
  flex-direction: column;
  gap: var(--sp-6);
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-4);
}
.head__title {
  font-size: var(--fs-2xl);
  font-weight: 800;
  letter-spacing: var(--tracking-tight);
  color: var(--text-strong);
}
.head__sub {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  margin-top: 2px;
}

.head__controls {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
.period-select {
  min-width: 210px;
}
@media (max-width: 560px) {
  .period-select {
    min-width: 100%;
  }
}

.seg {
  display: inline-flex;
  padding: 4px;
  gap: 2px;
  background: var(--surface);
  backdrop-filter: blur(var(--glass-blur));
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.seg__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
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

.kpis {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-5);
}
@media (max-width: 960px) {
  .kpis {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 520px) {
  .kpis {
    grid-template-columns: 1fr;
  }
}

.grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: var(--sp-5);
}
@media (max-width: 1000px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.card {
  padding: var(--sp-5);
}
.card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
}
.card__title {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--text-strong);
}
.card__hint {
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.side {
  display: flex;
}
.side > * {
  flex: 1;
}
</style>
