import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean;
    guestOnly?: boolean;
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/analisis',
      name: 'analytics',
      component: () => import('@/views/AnalyticsView.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : undefined };
  }
  if (to.meta.guestOnly && auth.isAuthenticated) {
    return { name: 'dashboard' };
  }
  return true;
});

/**
 * Recuperación tras un despliegue: si la pestaña quedó abierta con código viejo,
 * cargar una vista bajo demanda puede fallar porque su archivo ya no existe.
 * En ese caso recargamos la página una sola vez para traer la versión nueva.
 */
router.onError((error, to) => {
  const message = String(error?.message ?? '');
  const isChunkError =
    /dynamically imported module|Importing a module script failed|Failed to fetch|ChunkLoadError/i.test(message);
  if (isChunkError && to?.fullPath) {
    const reloadKey = 'tasks.chunkReloaded';
    if (!sessionStorage.getItem(reloadKey)) {
      sessionStorage.setItem(reloadKey, '1');
      window.location.assign(to.fullPath);
    }
  }
});

// Navegación correcta: limpiamos la marca de recarga.
router.afterEach(() => {
  try {
    sessionStorage.removeItem('tasks.chunkReloaded');
  } catch {
    /* sessionStorage no disponible */
  }
});

export default router;
