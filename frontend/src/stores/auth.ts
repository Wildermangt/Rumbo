import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '@/services/auth.api';
import { TOKEN_STORAGE_KEY } from '@/services/http';

interface JwtClaims {
  sub?: string;
  exp?: number;
}

/** Decodifica el payload del JWT (sin verificar: la verificación la hace el backend). */
function decodeClaims(token: string | null): JwtClaims | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_STORAGE_KEY));

  const claims = computed(() => decodeClaims(token.value));
  const username = computed(() => claims.value?.sub ?? null);
  const isAuthenticated = computed(() => {
    const exp = claims.value?.exp;
    return Boolean(token.value) && (!exp || exp * 1000 > Date.now());
  });

  async function login(user: string, password: string): Promise<void> {
    const result = await authApi.login(user, password);
    token.value = result.token;
    localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
  }

  function logout(): void {
    token.value = null;
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  return { token, username, isAuthenticated, login, logout };
});
