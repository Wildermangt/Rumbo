<script setup lang="ts">
import AppSnackbar from '@/components/AppSnackbar.vue';
</script>

<template>
  <v-app>
    <router-view v-slot="{ Component }">
      <transition name="route" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
    <AppSnackbar />
  </v-app>
</template>

<style>
/* Transición entre rutas: desvanecido discreto */
.route-enter-active {
  transition: opacity var(--dur-2) var(--ease-out);
}
.route-leave-active {
  transition: opacity var(--dur-1) var(--ease-out);
}
.route-enter-from,
.route-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .route-enter-active,
  .route-leave-active {
    transition: none;
  }
}
</style>
