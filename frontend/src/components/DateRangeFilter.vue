<script setup lang="ts">
import { computed, ref, watch } from 'vue';

/**
 * Filtro de fecha desplegable: un botón abre un menú con opciones rápidas
 * y un calendario para elegir un rango personalizado.
 * Se enlaza con dos v-model: `from` y `to` (formato YYYY-MM-DD).
 */
const from = defineModel<string>('from', { required: true });
const to = defineModel<string>('to', { required: true });

const menu = ref(false);
const showCalendar = ref(false);
const range = ref<unknown[]>([]);

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parse(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}
function fmt(value: string): string {
  const d = parse(value);
  return d ? d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) : '';
}

const active = computed(() => Boolean(from.value || to.value));
const label = computed(() => {
  if (from.value && to.value) return `${fmt(from.value)} – ${fmt(to.value)}`;
  if (from.value) return `Desde ${fmt(from.value)}`;
  if (to.value) return `Hasta ${fmt(to.value)}`;
  return 'Fecha';
});

const presets = computed(() => {
  const today = new Date();
  const start = (daysAgo: number): Date => {
    const d = new Date(today);
    d.setDate(d.getDate() - daysAgo);
    return d;
  };
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  return [
    { key: 'today', label: 'Hoy', from: iso(today), to: iso(today) },
    { key: '7d', label: 'Últimos 7 días', from: iso(start(6)), to: iso(today) },
    { key: '30d', label: 'Últimos 30 días', from: iso(start(29)), to: iso(today) },
    { key: 'month', label: 'Este mes', from: iso(monthStart), to: iso(today) },
  ];
});

function applyPreset(p: { from: string; to: string }): void {
  from.value = p.from;
  to.value = p.to;
  menu.value = false;
}

function openCalendar(): void {
  const f = parse(from.value);
  const t = parse(to.value);
  range.value = f && t ? [f, t] : f ? [f] : [];
  showCalendar.value = true;
}

function applyCalendar(): void {
  const dates = (range.value as (Date | string)[])
    .map((d) => (d instanceof Date ? d : new Date(d)))
    .sort((a, b) => a.getTime() - b.getTime());
  if (dates.length) {
    from.value = iso(dates[0]!);
    to.value = iso(dates[dates.length - 1]!);
  }
  menu.value = false;
}

function clear(): void {
  from.value = '';
  to.value = '';
  menu.value = false;
}

// Al cerrar el menú, vuelve siempre a la vista de opciones rápidas.
watch(menu, (open) => {
  if (!open) showCalendar.value = false;
});
</script>

<template>
  <v-menu v-model="menu" :close-on-content-click="false" location="bottom start" offset="8">
    <template #activator="{ props }">
      <button class="trigger" :class="{ active }" v-bind="props" data-testid="date-filter">
        <v-icon icon="mdi-calendar-range" size="18" />
        <span>{{ label }}</span>
        <v-icon :icon="menu ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="18" class="trigger__chev" />
      </button>
    </template>

    <div class="panel glass">
      <!-- Opciones rápidas -->
      <template v-if="!showCalendar">
        <p class="panel__title">Filtrar por fecha de creación</p>
        <button v-for="p in presets" :key="p.key" class="opt" @click="applyPreset(p)">
          <v-icon icon="mdi-clock-fast" size="17" /> {{ p.label }}
        </button>
        <button class="opt opt--accent" data-testid="date-custom" @click="openCalendar">
          <v-icon icon="mdi-calendar-edit" size="17" /> Rango personalizado…
        </button>
        <div class="panel__foot">
          <button class="link" :disabled="!active" @click="clear">Limpiar</button>
        </div>
      </template>

      <!-- Calendario de rango personalizado -->
      <template v-else>
        <div class="panel__head">
          <button class="back" aria-label="Volver" @click="showCalendar = false">
            <v-icon icon="mdi-arrow-left" size="18" />
          </button>
          <span class="panel__title">Elige el rango</span>
        </div>
        <v-date-picker v-model="range" multiple="range" color="primary" show-adjacent-months hide-header class="cal" />
        <div class="panel__foot">
          <button class="link" @click="clear">Limpiar</button>
          <button class="apply" data-testid="date-apply" @click="applyCalendar">Aplicar</button>
        </div>
      </template>
    </div>
  </v-menu>
</template>

<style scoped>
.trigger {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 46px;
  padding: 0 14px;
  border-radius: var(--radius-md);
  background: var(--glass-highlight);
  border: 1px solid var(--surface-border);
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  transition:
    border-color var(--dur-1),
    color var(--dur-1),
    background var(--dur-1);
}
.trigger:hover {
  color: var(--text-strong);
  border-color: var(--surface-border-strong);
}
.trigger.active {
  color: #fff;
  background: var(--gradient-accent);
  border-color: transparent;
  box-shadow: var(--shadow-accent);
}
.trigger__chev {
  opacity: 0.8;
}

.panel {
  width: 300px;
  max-width: 92vw;
  padding: var(--sp-3);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.panel__title {
  font-size: var(--fs-sm);
  font-weight: 700;
  color: var(--text-strong);
  padding: 6px 8px;
}
.panel__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.back {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
}
.back:hover {
  background: var(--glass-highlight);
  color: var(--text-strong);
}
.opt {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition:
    background var(--dur-1),
    color var(--dur-1);
}
.opt:hover {
  background: var(--glass-highlight);
  color: var(--text-strong);
}
.opt--accent {
  color: var(--accent-1);
  font-weight: 600;
}
.panel__foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--surface-border);
}
.link {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
}
.link:hover:not(:disabled) {
  color: var(--accent-1);
}
.link:disabled {
  opacity: 0.4;
  cursor: default;
}
.apply {
  background: var(--gradient-accent);
  color: #fff;
  border: none;
  padding: 8px 18px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-accent);
}
.cal {
  background: transparent !important;
  box-shadow: none !important;
}
</style>
