<script setup lang="ts">
import { computed } from 'vue';
import { useNotifier } from '@/composables/useNotifier';

const notifier = useNotifier();

const config = {
  success: { icon: 'mdi-check-circle', color: '#15803d' },
  error: { icon: 'mdi-alert-circle', color: '#dc2626' },
  warning: { icon: 'mdi-alert', color: '#b45309' },
  info: { icon: 'mdi-information', color: '#0891b2' },
} as const;

const visible = computed({
  get: () => notifier.state.visible,
  set: (v: boolean) => {
    if (!v) notifier.close();
  },
});
const current = computed(() => config[notifier.state.type]);
</script>

<template>
  <transition name="toast">
    <div v-if="visible" class="toast glass" role="status" aria-live="polite" data-testid="snackbar">
      <span class="toast__accent" :style="{ background: current.color }" />
      <v-icon :icon="current.icon" :style="{ color: current.color }" size="22" />
      <span class="toast__msg">{{ notifier.state.message }}</span>
      <button class="toast__close" aria-label="Cerrar" @click="notifier.close()">
        <v-icon icon="mdi-close" size="18" />
      </button>
      <!-- Barra de progreso del tiempo restante -->
      <span
        v-if="notifier.state.timeout"
        :key="notifier.state.message + notifier.state.timeout"
        class="toast__progress"
        :style="{ background: current.color, animationDuration: notifier.state.timeout + 'ms' }"
      />
    </div>
  </transition>
</template>

<style scoped>
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 3000;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-4) var(--sp-5);
  padding-left: calc(var(--sp-5) + 4px);
  min-width: 300px;
  max-width: min(92vw, 440px);
  overflow: hidden;
}
.toast__accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
}
.toast__msg {
  color: var(--text-strong);
  font-weight: 500;
  font-size: var(--fs-sm);
  flex: 1;
}
.toast__close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background var(--dur-1),
    color var(--dur-1);
}
.toast__close:hover {
  background: var(--glass-highlight);
  color: var(--text-strong);
}
.toast__progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  width: 100%;
  transform-origin: left;
  opacity: 0.7;
  animation-name: drain;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}
@keyframes drain {
  from {
    transform: scaleX(1);
  }
  to {
    transform: scaleX(0);
  }
}

.toast-enter-active,
.toast-leave-active {
  transition:
    opacity var(--dur-2) var(--ease-out),
    transform var(--dur-2) var(--ease-out);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(24px) scale(0.96);
}

@media (max-width: 600px) {
  .toast {
    left: 16px;
    right: 16px;
    top: 16px;
    min-width: 0;
  }
}
</style>
