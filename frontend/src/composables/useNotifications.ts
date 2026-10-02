import { computed, ref } from 'vue';
import { tasksApi } from '@/services/tasks.api';
import type { Notifications } from '@/types/task';

// Estado compartido a nivel de módulo: la campana del encabezado y el dashboard
// usan la misma fuente, y cualquier cambio en tareas puede refrescarla.
const data = ref<Notifications>({ overdue: 0, dueSoon: 0, items: [] });
const loading = ref(false);
let notifiedOverdue = 0; // evita repetir la notificación del navegador

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await tasksApi.notifications();
    maybeNotifyBrowser();
  } catch {
    /* silencioso: es información secundaria */
  } finally {
    loading.value = false;
  }
}

/** Notificación nativa del navegador (si el usuario dio permiso) para tareas vencidas. */
function maybeNotifyBrowser(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = data.value.overdue;
  if (n > 0 && n !== notifiedOverdue) {
    notifiedOverdue = n;
    new Notification('Rumbo — tareas vencidas', {
      body: n === 1 ? 'Tienes 1 tarea vencida.' : `Tienes ${n} tareas vencidas.`,
    });
  }
}

async function requestPermission(): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  const result = await Notification.requestPermission();
  if (result === 'granted') maybeNotifyBrowser();
}

export function useNotifications() {
  return {
    data,
    loading,
    total: computed(() => data.value.overdue + data.value.dueSoon),
    canAskPermission: computed(() => typeof Notification !== 'undefined' && Notification.permission === 'default'),
    load,
    requestPermission,
  };
}
