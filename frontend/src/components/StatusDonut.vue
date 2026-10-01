<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useCountUp } from '@/composables/useCountUp';

/** Donut SVG con animación de dibujo (stroke-dashoffset) y tooltip interactivo. */
const props = defineProps<{ pending: number; completed: number; loading?: boolean }>();

const R = 54;
const C = 2 * Math.PI * R;
const GAP = 6; // separación entre segmentos (en unidades de longitud de arco)

const total = computed(() => props.pending + props.completed);
const totalDisplay = useCountUp(toRef(props, 'completed')); // se recalcula abajo
const centerValue = useCountUp(total);
const pct = computed(() => (total.value ? Math.round((props.completed / total.value) * 100) : 0));

interface Seg {
  key: 'completed' | 'pending';
  label: string;
  value: number;
  color: string;
  len: number;
  offset: number;
}

const segments = computed<Seg[]>(() => {
  const t = total.value || 1;
  const items: Omit<Seg, 'len' | 'offset'>[] = [
    { key: 'completed', label: 'Completadas', value: props.completed, color: 'url(#gradDone)' },
    { key: 'pending', label: 'Pendientes', value: props.pending, color: 'url(#gradPend)' },
  ];
  let acc = 0;
  return items.map((it) => {
    const frac = it.value / t;
    const len = Math.max(frac * C - GAP, 0);
    const seg: Seg = { ...it, len, offset: -acc };
    acc += frac * C;
    return seg;
  });
});

// Reinicia la animación de dibujo cuando cambian los datos.
const drawn = ref(false);
watch(
  total,
  () => {
    drawn.value = false;
    requestAnimationFrame(() => requestAnimationFrame(() => (drawn.value = true)));
  },
  { immediate: true },
);

const hover = ref<Seg | null>(null);
void totalDisplay;
</script>

<template>
  <div class="donut glass">
    <div class="donut__head">
      <span class="donut__title">Progreso</span>
      <span class="donut__pct text-gradient">{{ pct }}%</span>
    </div>

    <div class="donut__chart">
      <svg viewBox="0 0 140 140" role="img" :aria-label="`${pct}% de tareas completadas`">
        <defs>
          <linearGradient id="gradDone" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#34d399" />
            <stop offset="100%" stop-color="#22d3ee" />
          </linearGradient>
          <linearGradient id="gradPend" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#60a5fa" />
            <stop offset="100%" stop-color="#2563eb" />
          </linearGradient>
        </defs>
        <circle class="track" cx="70" cy="70" :r="R" fill="none" stroke-width="14" />
        <circle
          v-for="seg in segments"
          :key="seg.key"
          class="seg"
          :class="{ dim: hover && hover.key !== seg.key }"
          cx="70"
          cy="70"
          :r="R"
          fill="none"
          stroke-width="14"
          stroke-linecap="round"
          :stroke="seg.color"
          :stroke-dasharray="`${seg.len} ${C - seg.len}`"
          :stroke-dashoffset="drawn ? seg.offset : C"
          @pointerenter="hover = seg"
          @pointerleave="hover = null"
        />
      </svg>

      <div class="donut__center">
        <template v-if="loading">
          <span class="skeleton" style="width: 46px; height: 30px" />
        </template>
        <template v-else>
          <span class="donut__total">{{ centerValue }}</span>
          <span class="donut__sub">tareas</span>
        </template>
      </div>

      <transition name="tip">
        <div v-if="hover" class="donut__tip">
          <b>{{ hover.label }}</b
          ><span>{{ hover.value }}</span>
        </div>
      </transition>
    </div>

    <div class="donut__legend">
      <button
        v-for="seg in segments"
        :key="seg.key"
        class="leg"
        @pointerenter="hover = seg"
        @pointerleave="hover = null"
      >
        <span class="dot" :class="seg.key" />
        <span>{{ seg.label }}</span>
        <b>{{ seg.value }}</b>
      </button>
    </div>
  </div>
</template>

<style scoped>
.donut {
  padding: var(--sp-5);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.donut__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.donut__title {
  font-weight: 700;
  color: var(--text-strong);
}
.donut__pct {
  font-weight: 800;
  font-size: var(--fs-lg);
}
.donut__chart {
  position: relative;
  display: grid;
  place-items: center;
  padding: var(--sp-2) 0;
}
svg {
  width: 170px;
  height: 170px;
  transform: rotate(-90deg);
}
.track {
  stroke: var(--surface-border);
}
.seg {
  transition:
    stroke-dashoffset 1s var(--ease-out),
    opacity var(--dur-2),
    filter var(--dur-2);
}
.seg.dim {
  opacity: 0.35;
}
.seg:hover {
  filter: drop-shadow(0 0 6px rgba(37, 99, 235, 0.45));
  cursor: pointer;
}
.donut__center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.donut__total {
  font-size: var(--fs-2xl);
  font-weight: 800;
  color: var(--text-strong);
  letter-spacing: var(--tracking-tight);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.donut__sub {
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.donut__tip {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface-solid);
  border: 1px solid var(--surface-border-strong);
  box-shadow: var(--shadow-md);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.donut__tip b {
  color: var(--text-strong);
}
.donut__tip span {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}
.tip-enter-active,
.tip-leave-active {
  transition:
    opacity var(--dur-1),
    transform var(--dur-1);
}
.tip-enter-from,
.tip-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-4px);
}

.donut__legend {
  display: flex;
  gap: var(--sp-2);
}
.leg {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  background: transparent;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  cursor: pointer;
  font-size: var(--fs-sm);
  color: var(--text);
  transition:
    border-color var(--dur-1),
    background var(--dur-1);
}
.leg:hover {
  border-color: var(--surface-border-strong);
  background: var(--glass-highlight);
}
.leg b {
  margin-left: auto;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.dot.completed {
  background: linear-gradient(135deg, #34d399, #22d3ee);
}
.dot.pending {
  background: linear-gradient(135deg, #60a5fa, #2563eb);
}
</style>
