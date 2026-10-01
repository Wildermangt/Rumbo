<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import StatCard from '@/components/StatCard.vue';
import StatusDonut from '@/components/StatusDonut.vue';
import TrendChart from '@/components/TrendChart.vue';
import { useNotifier } from '@/composables/useNotifier';
import { getErrorMessage } from '@/services/http';
import { tasksApi } from '@/services/tasks.api';
import type { StatsGranularity, TaskStats } from '@/types/task';

const notifier = useNotifier();

const granularities: { value: StatsGranularity; label: string; icon: string }[] = [
  { value: 'week', label: 'Semana', icon: 'mdi-calendar-week' },
  { value: 'month', label: 'Mes', icon: 'mdi-calendar-month' },
  { value: 'year', label: 'Año', icon: 'mdi-calendar-blank' },
];

const granularity = ref<StatsGranularity>('month');
const stats = ref<TaskStats | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);
let controller: AbortController | null = null;

async function load(): Promise<void> {
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  error.value = null;
  try {
    stats.value = await tasksApi.stats(granularity.value, current.signal);
  } catch (err) {
    if (current.signal.aborted) return;
    error.value = getErrorMessage(err);
    notifier.error(error.value);
  } finally {
    if (controller === current) loading.value = false;
  }
}

const granularityNoun: Record<StatsGranularity, string> = { week: 'semana', month: 'mes', year: 'año' };

watch(granularity, load);
onMounted(load);
</script>

<template>
  <v-main>
    <AppHeader />

    <div class="page">
      <!-- Encabezado + selector de granularidad -->
      <div v-reveal="0" class="head">
        <div>
          <h1 class="head__title">Análisis general</h1>
          <p class="head__sub">Métricas y evolución de tus tareas por {{ granularityNoun[granularity] }}.</p>
        </div>
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
  max-width: 1280px;
  margin: 0 auto;
  padding: var(--sp-5) var(--sp-5) var(--sp-8);
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-3);
  margin-bottom: var(--sp-5);
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
  gap: var(--sp-4);
  margin-bottom: var(--sp-5);
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
  gap: var(--sp-4);
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
