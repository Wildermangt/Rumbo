<script setup lang="ts">
import { computed } from 'vue';
import { PRIORITY_LABELS, type TaskPriority } from '@/types/task';

const props = defineProps<{ priority: TaskPriority }>();

const cfg = computed(
  () =>
    ({
      HIGH: { cls: 'high', icon: 'mdi-chevron-double-up' },
      MEDIUM: { cls: 'medium', icon: 'mdi-equal' },
      LOW: { cls: 'low', icon: 'mdi-chevron-double-down' },
    })[props.priority],
);
</script>

<template>
  <span class="pchip" :class="cfg.cls">
    <v-icon :icon="cfg.icon" size="14" />
    {{ PRIORITY_LABELS[priority] }}
  </span>
</template>

<style scoped>
.pchip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: var(--radius-full);
  font-size: var(--fs-xs);
  font-weight: 600;
  border: 1px solid transparent;
  white-space: nowrap;
}
.pchip.high {
  color: #dc2626;
  background: color-mix(in srgb, #dc2626 12%, transparent);
  border-color: color-mix(in srgb, #dc2626 28%, transparent);
}
.pchip.medium {
  color: #b45309;
  background: color-mix(in srgb, #d97706 13%, transparent);
  border-color: color-mix(in srgb, #d97706 28%, transparent);
}
.pchip.low {
  color: #0369a1;
  background: color-mix(in srgb, #0ea5e9 13%, transparent);
  border-color: color-mix(in srgb, #0ea5e9 28%, transparent);
}
</style>
