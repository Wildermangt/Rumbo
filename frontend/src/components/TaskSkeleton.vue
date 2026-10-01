<script setup lang="ts">
/** Filas skeleton con shimmer para sustituir el spinner mientras carga la tabla. */
defineProps<{ rows?: number }>();
</script>

<template>
  <div class="sk-wrap">
    <div v-for="n in rows ?? 6" :key="n" class="sk-row">
      <span class="skeleton" style="width: 28px; height: 14px" />
      <span class="skeleton" :style="{ width: 36 + ((n * 13) % 40) + '%', height: '14px' }" />
      <span class="skeleton sk-desc" :style="{ width: 30 + ((n * 7) % 30) + '%', height: '12px' }" />
      <span class="skeleton" style="width: 92px; height: 26px; border-radius: 999px" />
      <span class="skeleton sk-date" style="width: 110px; height: 12px" />
      <span class="skeleton" style="width: 104px; height: 32px; border-radius: 10px; margin-left: auto" />
    </div>
  </div>
</template>

<style scoped>
.sk-wrap {
  display: flex;
  flex-direction: column;
}
.sk-row {
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-4) var(--sp-5);
  border-top: 1px solid var(--surface-border);
}
.sk-row:first-child {
  border-top: none;
}
@media (max-width: 860px) {
  .sk-desc,
  .sk-date {
    display: none;
  }
}
</style>
