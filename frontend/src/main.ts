import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { useNotifier } from './composables/useNotifier';
import { resolveInitialTheme } from './composables/useTheme';
import { registerInteractions } from './directives/interactions';
import { createVuetifyPlugin } from './plugins/vuetify';
import router from './router';
import { setUnauthorizedHandler } from './services/http';
import { useAuthStore } from './stores/auth';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(createVuetifyPlugin(resolveInitialTheme()));
registerInteractions(app);

// Sesión expirada o token inválido => cerrar sesión y volver al login.
setUnauthorizedHandler(() => {
  const auth = useAuthStore(pinia);
  if (!auth.token) return;
  auth.logout();
  useNotifier().warning('Tu sesión expiró. Inicia sesión nuevamente.');
  void router.push({ name: 'login' });
});

app.mount('#app');
