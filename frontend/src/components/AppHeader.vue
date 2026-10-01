<script setup lang="ts">
import { useRouter } from 'vue-router';
import BrandMark from '@/components/BrandMark.vue';
import { useNotifier } from '@/composables/useNotifier';
import { useThemeToggle } from '@/composables/useTheme';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const notifier = useNotifier();
const { isDark, toggle } = useThemeToggle();

const nav = [
  { to: '/', label: 'Tareas', icon: 'mdi-format-list-checks' },
  { to: '/analisis', label: 'Análisis', icon: 'mdi-chart-box-outline' },
];

function logout(): void {
  auth.logout();
  notifier.info('Sesión cerrada');
  void router.replace({ name: 'login' });
}
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
</style>
