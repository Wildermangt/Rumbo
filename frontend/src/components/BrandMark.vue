<script setup lang="ts">
/** Isotipo de Rumbo: una aguja de brújula que apunta hacia adelante. */
withDefaults(defineProps<{ size?: number }>(), { size: 20 });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M16 4 L26 28 L16 22 L6 28 Z" fill="currentColor" />
    <path d="M16 4 L16 22 L6 28 Z" fill="currentColor" opacity="0.55" />
  </svg>
</template>
