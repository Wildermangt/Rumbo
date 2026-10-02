<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import BrandMark from '@/components/BrandMark.vue';
import { useNotifications } from '@/composables/useNotifications';
import { useNotifier } from '@/composables/useNotifier';
import { useThemeToggle } from '@/composables/useTheme';
import { useAuthStore } from '@/stores/auth';
import { PRIORITY_LABELS } from '@/types/task';

const auth = useAuthStore();
const router = useRouter();
const notifier = useNotifier();
const { isDark, toggle } = useThemeToggle();
const notifs = useNotifications();

const nav = [
  { to: '/', label: 'Tareas', icon: 'mdi-format-list-checks' },
  { to: '/analisis', label: 'Análisis', icon: 'mdi-chart-box-outline' },
];

const dateFmt = new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short' });
const formatDue = (d: string | null): string => (d ? dateFmt.format(new Date(`${d}T00:00:00`)) : '');

function logout(): void {
  auth.logout();
  notifier.info('Sesión cerrada');
  void router.replace({ name: 'login' });
}

onMounted(() => void notifs.load());
</script>

<template>
  <header class="bar glass">
    <div class="bar__brand">
      <div class="bar__logo"><BrandMark :size="20" /></div>
      <span class="bar__name">Rumbo</span>
    </div>

    <nav class="bar__nav">
      <router-link v-for="n in nav" :key="n.to" :to="n.to" class="nav-link" active-class="active">
        <v-icon :icon="n.icon" size="18" /> <span>{{ n.label }}</span>
      </router-link>
    </nav>

    <div class="bar__right">
      <!-- Campana de notificaciones -->
      <v-menu location="bottom end" offset="10" :close-on-content-click="false">
        <template #activator="{ props }">
          <button class="icon-btn bell" aria-label="Notificaciones" data-testid="notif-bell" v-bind="props">
            <v-icon icon="mdi-bell-outline" />
            <span v-if="notifs.total.value" class="bell__badge" :class="{ danger: notifs.data.value.overdue }">
              {{ notifs.total.value > 9 ? '9+' : notifs.total.value }}
            </span>
          </button>
        </template>

        <div class="notif glass">
          <div class="notif__head">
            <span>Vencimientos</span>
            <button class="notif__refresh" aria-label="Actualizar" @click="notifs.load()">
              <v-icon icon="mdi-refresh" size="16" />
            </button>
          </div>

          <div v-if="notifs.data.value.overdue || notifs.data.value.dueSoon" class="notif__summary">
            <span v-if="notifs.data.value.overdue" class="tag over">{{ notifs.data.value.overdue }} vencida(s)</span>
            <span v-if="notifs.data.value.dueSoon" class="tag soon">{{ notifs.data.value.dueSoon }} por vencer</span>
          </div>

          <div v-if="notifs.data.value.items.length" class="notif__list">
            <router-link
              v-for="it in notifs.data.value.items"
              :key="it.id"
              to="/"
              class="notif__item"
              :class="it.kind === 'OVERDUE' ? 'over' : 'soon'"
            >
              <v-icon :icon="it.kind === 'OVERDUE' ? 'mdi-alert-circle' : 'mdi-clock-alert-outline'" size="16" />
              <span class="notif__title">{{ it.title }}</span>
              <span class="notif__due">
                {{ it.kind === 'OVERDUE' ? 'Venció' : 'Vence' }} {{ formatDue(it.dueDate) }}
                <small>· {{ PRIORITY_LABELS[it.priority] }}</small>
              </span>
            </router-link>
          </div>
          <p v-else class="notif__empty">Sin tareas vencidas ni próximas a vencer.</p>

          <button v-if="notifs.canAskPermission.value" class="notif__perm" @click="notifs.requestPermission()">
            <v-icon icon="mdi-bell-ring-outline" size="15" /> Activar avisos del navegador
          </button>
        </div>
      </v-menu>

      <button class="icon-btn" :aria-label="isDark ? 'Modo claro' : 'Modo oscuro'" @click="toggle">
        <v-icon :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'" />
      </button>
      <span class="bar__user"><v-icon icon="mdi-account-circle" size="20" /> {{ auth.username }}</span>
      <v-btn variant="text" prepend-icon="mdi-logout" data-testid="logout" @click="logout">Salir</v-btn>
    </div>
  </header>
</template>

<style scoped>
.bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-3) var(--sp-5);
  border-radius: 0;
  border-left: none;
  border-right: none;
  border-top: none;
}
.bar::before {
  border-radius: 0;
}
.bar__brand {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.bar__logo {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--accent-1);
  color: #fff;
}
.bar__name {
  font-size: var(--fs-lg);
  font-weight: 800;
  letter-spacing: var(--tracking-tight);
  color: var(--text-strong);
}

.bar__nav {
  display: flex;
  gap: 4px;
  margin-left: var(--sp-3);
}
.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 600;
  font-size: var(--fs-sm);
  transition:
    color var(--dur-1),
    background var(--dur-1);
}
.nav-link:hover {
  color: var(--text-strong);
  background: var(--glass-highlight);
}
.nav-link.active {
  color: #fff;
  background: var(--gradient-accent);
  box-shadow: var(--shadow-accent);
}

.bar__right {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-left: auto;
}
.bar__user {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: var(--radius-full);
  background: var(--glass-highlight);
  border: 1px solid var(--surface-border);
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 500;
}
.icon-btn {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--surface-border);
  color: var(--text);
  cursor: pointer;
  transition:
    background var(--dur-1),
    color var(--dur-1);
}
.icon-btn:hover {
  background: var(--glass-highlight);
  color: var(--accent-1);
}

@media (max-width: 720px) {
  .bar__nav .nav-link span {
    display: none;
  }
  .bar__user {
    display: none;
  }
}

/* Campana */
.bell {
  position: relative;
}
.bell__badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: var(--radius-full);
  background: var(--warning);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: grid;
  place-items: center;
  border: 2px solid var(--surface);
}
.bell__badge.danger {
  background: #dc2626;
}

/* Panel de notificaciones */
.notif {
  width: 340px;
  max-width: 92vw;
  padding: var(--sp-3);
}
.notif__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
  color: var(--text-strong);
  padding: 4px 6px 8px;
}
.notif__refresh {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.notif__refresh:hover {
  color: var(--accent-1);
}
.notif__summary {
  display: flex;
  gap: 6px;
  padding: 0 6px 8px;
}
.tag {
  font-size: var(--fs-xs);
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
}
.tag.over {
  color: #dc2626;
  background: color-mix(in srgb, #dc2626 12%, transparent);
}
.tag.soon {
  color: #b45309;
  background: color-mix(in srgb, #d97706 13%, transparent);
}
.notif__list {
  max-height: 320px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.notif__item {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-rows: auto auto;
  column-gap: 8px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--text);
  transition: background var(--dur-1);
}
.notif__item:hover {
  background: var(--glass-highlight);
}
.notif__item.over {
  color: var(--text);
}
.notif__item .v-icon {
  grid-row: 1 / 3;
}
.notif__item.over .v-icon {
  color: #dc2626;
}
.notif__item.soon .v-icon {
  color: #b45309;
}
.notif__title {
  font-weight: 600;
  color: var(--text-strong);
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notif__due {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  grid-column: 2;
}
.notif__empty {
  padding: 10px;
  color: var(--text-muted);
  font-size: var(--fs-sm);
  text-align: center;
}
.notif__perm {
  width: 100%;
  margin-top: 6px;
  padding: 8px;
  border-radius: var(--radius-sm);
  background: var(--glass-highlight);
  border: 1px solid var(--surface-border);
  color: var(--accent-1);
  font-weight: 600;
  font-size: var(--fs-sm);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.notif__perm:hover {
  background: color-mix(in srgb, var(--accent-1) 8%, transparent);
}
</style>
