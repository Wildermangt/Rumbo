import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import '@/styles/main.css';
import { createVuetify, type ThemeDefinition } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import { es } from 'vuetify/locale';

const light: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#f4f6fa',
    surface: '#ffffff',
    primary: '#2563eb',
    secondary: '#0ea5e9',
    success: '#15803d',
    warning: '#b45309',
    error: '#dc2626',
    info: '#0ea5e9',
  },
};

const dark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0b1120',
    surface: '#151e32',
    primary: '#60a5fa',
    secondary: '#38bdf8',
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#38bdf8',
  },
};

export function createVuetifyPlugin(initialTheme: 'light' | 'dark') {
  return createVuetify({
    locale: { locale: 'es', messages: { es } },
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
    theme: { defaultTheme: initialTheme, themes: { light, dark } },
    defaults: {
      VBtn: { rounded: 'lg', class: 'text-none' },
      VCard: { rounded: 'lg' },
      VTextField: { variant: 'outlined', density: 'comfortable' },
      VTextarea: { variant: 'outlined', density: 'comfortable' },
    },
  });
}
