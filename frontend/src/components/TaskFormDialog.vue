<script setup lang="ts">
import { ref, watch } from 'vue';
import type { CreateTaskPayload } from '@/types/task';

const props = defineProps<{ loading: boolean }>();
const emit = defineEmits<{ submit: [payload: CreateTaskPayload] }>();
const open = defineModel<boolean>({ required: true });

const TITLE_MAX = 150;
const DESCRIPTION_MAX = 4000;

const formRef = ref<{ validate: () => Promise<{ valid: boolean }>; resetValidation: () => void } | null>(null);
const title = ref('');
const description = ref('');

const titleRules = [
  (v: string) => v.trim().length > 0 || 'El título es obligatorio',
  (v: string) => v.trim().length <= TITLE_MAX || `Máximo ${TITLE_MAX} caracteres`,
];
const descriptionRules = [(v: string) => v.length <= DESCRIPTION_MAX || `Máximo ${DESCRIPTION_MAX} caracteres`];

watch(open, (isOpen) => {
  if (isOpen) {
    title.value = '';
    description.value = '';
    formRef.value?.resetValidation();
  }
});

async function onSubmit(): Promise<void> {
  const result = await formRef.value?.validate();
  if (!result?.valid || props.loading) return;
  emit('submit', { title: title.value.trim(), description: description.value.trim() || null });
}
</script>

<template>
  <!-- v-dialog ya cierra con ESC y clic fuera; añadimos scrim con blur. -->
  <v-dialog v-model="open" max-width="540" :persistent="loading" scrim="#0a0b14" class="task-dialog">
    <div class="dlg glass" data-testid="task-form-dialog">
      <header class="dlg__head">
        <div class="dlg__badge"><v-icon icon="mdi-plus" /></div>
        <div>
          <h2 class="dlg__title">Nueva tarea</h2>
          <p class="dlg__sub">Completa los datos para registrar una tarea.</p>
        </div>
        <button class="dlg__x" aria-label="Cerrar" :disabled="loading" @click="open = false">
          <v-icon icon="mdi-close" />
        </button>
      </header>

      <v-form ref="formRef" class="dlg__body" @submit.prevent="onSubmit">
        <v-text-field
          v-model="title"
          label="Título"
          prepend-inner-icon="mdi-format-title"
          :rules="titleRules"
          :counter="TITLE_MAX"
          :disabled="loading"
          autofocus
          data-testid="task-title"
        />
        <v-textarea
          v-model="description"
          label="Descripción (opcional)"
          prepend-inner-icon="mdi-text"
          :rules="descriptionRules"
          :disabled="loading"
          rows="4"
          auto-grow
          data-testid="task-description"
        />
        <div class="dlg__actions">
          <v-btn variant="text" :disabled="loading" @click="open = false">Cancelar</v-btn>
          <v-btn
            type="submit"
            class="btn-accent"
            :loading="loading"
            prepend-icon="mdi-content-save"
            data-testid="task-submit"
          >
            Guardar tarea
          </v-btn>
        </div>
      </v-form>
    </div>
  </v-dialog>
</template>

<style scoped>
.dlg {
  padding: var(--sp-5) var(--sp-6) var(--sp-6);
}
.dlg__head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.dlg__badge {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background: var(--accent-1);
  color: #fff;
}
.dlg__title {
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--text-strong);
  line-height: 1.2;
}
.dlg__sub {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  margin-top: 2px;
}
.dlg__x {
  margin-left: auto;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background var(--dur-1),
    color var(--dur-1);
}
.dlg__x:hover {
  background: var(--glass-highlight);
  color: var(--text-strong);
}
.dlg__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
</style>

<style>
/* Desenfoque del fondo del diálogo (scrim) */
.task-dialog .v-overlay__scrim {
  backdrop-filter: blur(6px);
  opacity: 0.55 !important;
}
</style>
