<script setup lang="ts">
import { computed, toRef } from 'vue';
import { useCountUp } from '@/composables/useCountUp';

const props = defineProps<{
  label: string;
  value: number;
  icon: string;
  tone: 'accent' | 'warning' | 'success';
  loading?: boolean;
  suffix?: string;
  /** Si true, muestra "—" en lugar del valor (p. ej. sin datos). */
  empty?: boolean;
}>();

const display = useCountUp(toRef(props, 'value'));
const toneColor = computed(
  () => ({ accent: 'var(--accent-1)', warning: 'var(--warning)', success: 'var(--success)' })[props.tone],
);
</script>

<template>
  <div class="stat glass">
    <div class="stat__icon" :style="{ color: toneColor }">
      <v-icon :icon="icon" size="26" />
    </div>
    <div class="stat__body">
      <span class="stat__label">{{ label }}</span>
      <span v-if="loading" class="skeleton stat__sk" />
      <span v-else class="stat__value">
        <template v-if="empty">—</template>
        <template v-else
          >{{ display }}<small v-if="suffix" class="stat__suffix">{{ suffix }}</small></template
        >
      </span>
    </div>
    <span class="stat__bar" :style="{ background: toneColor }" />
  </div>
</template>

<style scoped>
.stat {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-5);
  overflow: hidden;
}
.stat__icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, currentColor 14%, transparent);
  flex-shrink: 0;
}
.stat__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.stat__label {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  font-weight: 500;
}
.stat__value {
  font-size: var(--fs-2xl);
  font-weight: 800;
  letter-spacing: var(--tracking-tight);
  color: var(--text-strong);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.stat__suffix {
  font-size: var(--fs-base);
  font-weight: 700;
  color: var(--text-muted);
  margin-left: 2px;
}
.stat__sk {
  width: 48px;
  height: 30px;
  margin-top: 4px;
}
.stat__bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  opacity: 0.9;
  transform-origin: top;
  animation: growBar var(--dur-4) var(--ease-out) backwards;
}
/* El icono reacciona al hover de la tarjeta */
.stat:hover .stat__icon {
  transform: scale(1.08) rotate(-4deg);
}
.stat__icon {
  transition: transform var(--dur-2) var(--ease-out);
}
</style>
