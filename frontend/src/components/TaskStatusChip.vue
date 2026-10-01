<script setup lang="ts">
import { computed } from 'vue';
import type { TaskStatus } from '@/types/task';

const props = defineProps<{ status: TaskStatus }>();

const cfg = computed(() =>
  props.status === 'COMPLETED'
    ? { cls: 'done', icon: 'mdi-check-circle', label: 'Completada' }
    : { cls: 'pending', icon: 'mdi-clock-outline', label: 'Pendiente' },
);
</script>

<template>
  <span class="chip" :class="cfg.cls">
    <v-icon :icon="cfg.icon" size="15" />
    {{ cfg.label }}
  </span>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  border-radius: var(--radius-full);
  font-size: var(--fs-xs);
  font-weight: 600;
  border: 1px solid transparent;
  white-space: nowrap;
}
.chip.pending {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 13%, transparent);
  border-color: color-mix(in srgb, var(--warning) 28%, transparent);
}
.chip.done {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 14%, transparent);
  border-color: color-mix(in srgb, var(--success) 30%, transparent);
}
</style>
