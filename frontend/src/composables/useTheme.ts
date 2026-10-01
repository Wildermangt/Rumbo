import { computed } from 'vue';
import { useTheme as useVuetifyTheme } from 'vuetify';

const STORAGE_KEY = 'tasks.theme';

/** Preferencia inicial: lo guardado, o el esquema del sistema. */
export function resolveInitialTheme(): 'light' | 'dark' {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Alterna el tema de Vuetify y lo persiste. */
export function useThemeToggle() {
  const theme = useVuetifyTheme();
  const isDark = computed(() => theme.global.name.value === 'dark');

  function toggle(): void {
    const next = isDark.value ? 'light' : 'dark';
    theme.change(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  return { isDark, toggle };
}
