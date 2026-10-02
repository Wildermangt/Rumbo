<script setup lang="ts">
import AppSnackbar from '@/components/AppSnackbar.vue';
</script>

<template>
  <v-app>
    <router-view v-slot="{ Component, route }">
      <component :is="Component" :key="route.path" />
    </router-view>
    <AppSnackbar />
  </v-app>
</template>

<style>
/* Sin <transition mode="out-in"> en el router-view (dejaba la vista en blanco al
   navegar); la entrada de cada sección la aporta la directiva v-reveal. */
</style>
