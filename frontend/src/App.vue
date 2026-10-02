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
/*
 * No se usa <transition mode="out-in"> en el router-view: esa transición dejaba
 * la vista en blanco al navegar en el cliente (la salida no terminaba y la nueva
 * vista nunca entraba, obligando a refrescar). La entrada en cascada de cada
 * sección la aporta la directiva v-reveal, así que la navegación es inmediata.
 */
</style>
