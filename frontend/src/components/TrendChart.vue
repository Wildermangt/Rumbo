<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { StatsBucket } from '@/types/task';

/**
 * Gráfico de tendencia (creadas vs completadas) en SVG nativo.
 * - Responsive con ResizeObserver (sin layout thrashing).
 * - Animación de dibujo del trazo (stroke-dashoffset) + relleno con gradiente.
 * - Tooltip interactivo con guía vertical siguiendo el puntero.
 */
const props = defineProps<{ series: StatsBucket[]; loading?: boolean }>();

const H = 280;
const PAD = { t: 16, r: 16, b: 34, l: 34 };

const wrap = ref<HTMLElement | null>(null);
const width = ref(640);
let ro: ResizeObserver | null = null;

onMounted(() => {
  if (!wrap.value) return;
  ro = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width;
    if (w) width.value = Math.max(320, Math.floor(w));
  });
  ro.observe(wrap.value);
  width.value = Math.max(320, wrap.value.clientWidth);
});
onBeforeUnmount(() => ro?.disconnect());

const plotW = computed(() => width.value - PAD.l - PAD.r);
const plotH = H - PAD.t - PAD.b;
const maxY = computed(() => Math.max(1, ...props.series.flatMap((d) => [d.created, d.completed])));

const stepX = computed(() => (props.series.length > 1 ? plotW.value / (props.series.length - 1) : 0));
const xAt = (i: number): number => PAD.l + (props.series.length > 1 ? i * stepX.value : plotW.value / 2);
const yAt = (v: number): number => PAD.t + plotH - (v / maxY.value) * plotH;

function linePath(key: 'created' | 'completed'): string {
  if (!props.series.length) return '';
  return props.series.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yAt(d[key]).toFixed(1)}`).join(' ');
}
function areaPath(key: 'created' | 'completed'): string {
  if (!props.series.length) return '';
  const base = PAD.t + plotH;
  return `${linePath(key)} L ${xAt(props.series.length - 1).toFixed(1)} ${base} L ${xAt(0).toFixed(1)} ${base} Z`;
}

// Marcas del eje Y (0, mitad, max).
const yTicks = computed(() => {
  const m = maxY.value;
  const vals = m <= 4 ? Array.from({ length: m + 1 }, (_, i) => i) : [0, Math.round(m / 2), m];
  return [...new Set(vals)].map((v) => ({ v, y: yAt(v) }));
});

// Etiquetas X (muestra como máximo ~8 para no saturar).
const xLabels = computed(() => {
  const n = props.series.length;
  const stride = Math.ceil(n / 8);
  return props.series.map((d, i) => ({ i, label: d.label, show: i % stride === 0 || i === n - 1, x: xAt(i) }));
});

// Animación de dibujo: se reinicia al cambiar los datos.
const drawn = ref(false);
watch(
  () => props.series.map((d) => d.bucket).join('|'),
  () => {
    drawn.value = false;
    requestAnimationFrame(() => requestAnimationFrame(() => (drawn.value = true)));
  },
  { immediate: true },
);

// Tooltip / hover.
const hoverIdx = ref<number | null>(null);
function onMove(e: PointerEvent): void {
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
  const x = e.clientX - rect.left - PAD.l;
  const idx = stepX.value > 0 ? Math.round(x / stepX.value) : 0;
  hoverIdx.value = Math.max(0, Math.min(props.series.length - 1, idx));
}
const hover = computed(() => (hoverIdx.value != null ? props.series[hoverIdx.value] : null));
const tipLeft = computed(() => {
  if (hoverIdx.value == null) return 0;
  const x = xAt(hoverIdx.value);
  return Math.max(70, Math.min(width.value - 70, x));
});
</script>

<template>
  <div ref="wrap" class="trend">
    <div v-if="loading" class="skeleton" :style="{ height: H + 'px', width: '100%' }" />
    <template v-else>
      <svg :width="width" :height="H" @pointermove="onMove" @pointerleave="hoverIdx = null">
        <defs>
          <linearGradient id="areaCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2563eb" stop-opacity="0.35" />
            <stop offset="100%" stop-color="#2563eb" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="areaDone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#34d399" stop-opacity="0.3" />
            <stop offset="100%" stop-color="#34d399" stop-opacity="0" />
          </linearGradient>
          <linearGradient id="lineCreated" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#2563eb" />
            <stop offset="100%" stop-color="#0ea5e9" />
          </linearGradient>
          <linearGradient id="lineDone" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#22d3ee" />
            <stop offset="100%" stop-color="#34d399" />
          </linearGradient>
        </defs>

        <!-- Rejilla + eje Y -->
        <g class="grid">
          <template v-for="t in yTicks" :key="t.v">
            <line :x1="PAD.l" :y1="t.y" :x2="width - PAD.r" :y2="t.y" />
            <text :x="PAD.l - 8" :y="t.y + 4" text-anchor="end">{{ t.v }}</text>
          </template>
        </g>

        <!-- Áreas -->
        <path class="area" :class="{ in: drawn }" :d="areaPath('created')" fill="url(#areaCreated)" />
        <path class="area" :class="{ in: drawn }" :d="areaPath('completed')" fill="url(#areaDone)" />

        <!-- Líneas con animación de trazado -->
        <path class="line" :class="{ in: drawn }" :d="linePath('created')" stroke="url(#lineCreated)" />
        <path class="line" :class="{ in: drawn }" :d="linePath('completed')" stroke="url(#lineDone)" />

        <!-- Puntos -->
        <g v-for="(d, i) in series" :key="d.bucket">
          <circle class="dot c" :cx="xAt(i)" :cy="yAt(d.created)" r="3.5" />
          <circle class="dot d" :cx="xAt(i)" :cy="yAt(d.completed)" r="3.5" />
        </g>

        <!-- Guía + puntos destacados del hover -->
        <g v-if="hover && hoverIdx != null" class="cursor">
          <line :x1="xAt(hoverIdx)" :y1="PAD.t" :x2="xAt(hoverIdx)" :y2="PAD.t + plotH" />
          <circle class="hl c" :cx="xAt(hoverIdx)" :cy="yAt(hover.created)" r="5" />
          <circle class="hl d" :cx="xAt(hoverIdx)" :cy="yAt(hover.completed)" r="5" />
        </g>

        <!-- Etiquetas X -->
        <g class="xaxis">
          <text v-for="l in xLabels" v-show="l.show" :key="l.i" :x="l.x" :y="H - 12" text-anchor="middle">
            {{ l.label }}
          </text>
        </g>
      </svg>

      <transition name="tip">
        <div v-if="hover" class="trend__tip" :style="{ left: tipLeft + 'px' }">
          <div class="trend__tip-label">{{ hover.label }}</div>
          <div class="trend__tip-row">
            <span class="dotm c" />Creadas<b>{{ hover.created }}</b>
          </div>
          <div class="trend__tip-row">
            <span class="dotm d" />Completadas<b>{{ hover.completed }}</b>
          </div>
        </div>
      </transition>

      <div class="trend__legend">
        <span class="leg"><span class="dotm c" /> Creadas</span>
        <span class="leg"><span class="dotm d" /> Completadas</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.trend {
  position: relative;
  width: 100%;
}
svg {
  display: block;
  width: 100%;
  overflow: visible;
  touch-action: none;
}

.grid line {
  stroke: var(--surface-border);
  stroke-dasharray: 3 4;
}
.grid text,
.xaxis text {
  fill: var(--text-muted);
  font-size: 11px;
}

.area {
  opacity: 0;
  transition: opacity var(--dur-4) var(--ease-out) 0.2s;
}
.area.in {
  opacity: 1;
}

.line {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 2200;
  stroke-dashoffset: 2200;
}
.line.in {
  transition: stroke-dashoffset 1.1s var(--ease-out);
  stroke-dashoffset: 0;
}

.dot {
  opacity: 0;
  transition: opacity var(--dur-2) 0.9s;
}
.area.in ~ .dot,
.line.in ~ g .dot {
  opacity: 1;
}
.dot.c {
  fill: #2563eb;
}
.dot.d {
  fill: #34d399;
}

.cursor line {
  stroke: var(--text-muted);
  stroke-dasharray: 3 3;
  opacity: 0.5;
}
.hl {
  stroke: var(--surface-solid);
  stroke-width: 2;
}
.hl.c {
  fill: #2563eb;
}
.hl.d {
  fill: #34d399;
}

.trend__tip {
  position: absolute;
  top: 6px;
  transform: translateX(-50%);
  background: var(--surface-solid);
  border: 1px solid var(--surface-border-strong);
  box-shadow: var(--shadow-md);
  border-radius: var(--radius-sm);
  padding: 8px 11px;
  pointer-events: none;
  min-width: 128px;
  z-index: 2;
}
.trend__tip-label {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin-bottom: 4px;
  font-weight: 600;
}
.trend__tip-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--text);
}
.trend__tip-row b {
  margin-left: auto;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
}
.tip-enter-active,
.tip-leave-active {
  transition: opacity var(--dur-1);
}
.tip-enter-from,
.tip-leave-to {
  opacity: 0;
}

.trend__legend {
  display: flex;
  gap: var(--sp-4);
  justify-content: center;
  margin-top: var(--sp-2);
}
.leg {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.dotm {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
.dotm.c {
  background: linear-gradient(135deg, #2563eb, #0ea5e9);
}
.dotm.d {
  background: linear-gradient(135deg, #22d3ee, #34d399);
}
</style>
