import { reactive, readonly } from 'vue';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

interface NotifierState {
  visible: boolean;
  message: string;
  type: NotificationType;
  timeout: number;
}

// Estado a nivel de módulo: un único snackbar global compartido por toda la app.
const state = reactive<NotifierState>({ visible: false, message: '', type: 'info', timeout: 4000 });

function show(message: string, type: NotificationType, timeout = 4000): void {
  state.message = message;
  state.type = type;
  state.timeout = timeout;
  state.visible = true;
}

export function useNotifier() {
  return {
    state: readonly(state),
    success: (message: string) => show(message, 'success'),
    error: (message: string) => show(message, 'error', 6000),
    info: (message: string) => show(message, 'info'),
    warning: (message: string) => show(message, 'warning'),
    close: () => {
      state.visible = false;
    },
  };
}
