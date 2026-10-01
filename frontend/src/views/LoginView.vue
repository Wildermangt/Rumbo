<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BrandMark from '@/components/BrandMark.vue';
import { useNotifier } from '@/composables/useNotifier';
import { useThemeToggle } from '@/composables/useTheme';
import { getErrorMessage } from '@/services/http';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const notifier = useNotifier();
const { isDark, toggle } = useThemeToggle();

const formRef = ref<{ validate: () => Promise<{ valid: boolean }> } | null>(null);
const username = ref('');
const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const error = ref<string | null>(null);

const required = (label: string) => (v: string) => v.trim().length > 0 || `${label} es obligatorio`;

async function onSubmit(): Promise<void> {
  const result = await formRef.value?.validate();
  if (!result?.valid) return;
  loading.value = true;
  error.value = null;
  try {
    await auth.login(username.value.trim(), password.value);
    notifier.success(`Bienvenido, ${auth.username}`);
    const redirect =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/';
    await router.replace(redirect);
  } catch (err) {
    error.value = getErrorMessage(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <v-main class="login">
    <button class="theme-toggle glass" :aria-label="isDark ? 'Modo claro' : 'Modo oscuro'" @click="toggle">
      <v-icon :icon="isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'" />
    </button>

    <div class="login__wrap">
      <div class="card glass">
        <div class="brand">
          <div class="brand__logo"><BrandMark :size="28" /></div>
          <h1 class="brand__name">Rumbo</h1>
          <p class="brand__sub">Organiza tu trabajo y mantén el rumbo</p>
        </div>

        <transition name="shake">
          <div v-if="error" class="alert" data-testid="login-error">
            <v-icon icon="mdi-alert-circle" size="18" />
            <span>{{ error }}</span>
            <button aria-label="Cerrar" @click="error = null"><v-icon icon="mdi-close" size="16" /></button>
          </div>
        </transition>

        <v-form ref="formRef" @submit.prevent="onSubmit">
          <div v-reveal="80">
            <v-text-field
              v-model="username"
              label="Usuario"
              prepend-inner-icon="mdi-account-outline"
              autocomplete="username"
              :rules="[required('El usuario')]"
              :disabled="loading"
              data-testid="login-username"
            />
          </div>
          <div v-reveal="140">
            <v-text-field
              v-model="password"
              label="Contraseña"
              prepend-inner-icon="mdi-lock-outline"
              :type="showPassword ? 'text' : 'password'"
              :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              autocomplete="current-password"
              :rules="[required('La contraseña')]"
              :disabled="loading"
              data-testid="login-password"
              @click:append-inner="showPassword = !showPassword"
            />
          </div>
          <div v-reveal="200">
            <v-btn
              type="submit"
              size="large"
              block
              class="btn-accent login__submit"
              :loading="loading"
              append-icon="mdi-arrow-right"
              data-testid="login-submit"
            >
              Ingresar
            </v-btn>
          </div>
        </v-form>

        <div v-reveal="260" class="hint">
          <v-icon icon="mdi-information-outline" size="16" />
          Credenciales de prueba: <b>admin</b> / <b>admin123</b>
        </div>
      </div>
    </div>
  </v-main>
</template>

<style scoped>
.login {
  position: relative;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: radial-gradient(1100px 480px at 50% -12%, var(--bg-accent), transparent 70%);
}
.login__wrap {
  width: 100%;
  max-width: 440px;
  padding: var(--sp-4);
}
.card {
  padding: var(--sp-7) var(--sp-6);
}

.theme-toggle {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 10;
  width: 46px;
  height: 46px;
  border-radius: var(--radius-md);
  display: grid;
  place-items: center;
  cursor: pointer;
  color: var(--text);
  transition:
    transform var(--dur-1) var(--ease-out),
    color var(--dur-1);
}
.theme-toggle:hover {
  transform: rotate(-12deg) scale(1.05);
  color: var(--accent-1);
}

.brand {
  text-align: center;
  margin-bottom: var(--sp-5);
}
.brand__logo {
  width: 60px;
  height: 60px;
  margin: 0 auto var(--sp-4);
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--accent-1);
  color: #fff;
}
.brand__name {
  font-size: var(--fs-2xl);
  font-weight: 800;
  letter-spacing: var(--tracking-tight);
  color: var(--text-strong);
}
.brand__sub {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  margin-top: 4px;
}

.login__submit {
  margin-top: var(--sp-2);
  height: 50px;
  font-weight: 700;
}

.alert {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--sp-4);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #dc2626 12%, transparent);
  border: 1px solid color-mix(in srgb, #dc2626 30%, transparent);
  color: #ef4444;
  font-size: var(--fs-sm);
}
.alert span {
  flex: 1;
}
.alert button {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  display: grid;
  place-items: center;
}

.hint {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: center;
  margin-top: var(--sp-5);
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--glass-highlight);
  border: 1px solid var(--surface-border);
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
.hint b {
  color: var(--text);
}

.shake-enter-active {
  animation: shake 0.4s var(--ease-out);
}
@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20%,
  60% {
    transform: translateX(-6px);
  }
  40%,
  80% {
    transform: translateX(6px);
  }
}
</style>
