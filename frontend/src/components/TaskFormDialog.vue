<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useNotifier } from '@/composables/useNotifier';
import { getErrorMessage } from '@/services/http';
import { tasksApi } from '@/services/tasks.api';
import {
  PRIORITY_LABELS,
  RECURRENCE_LABELS,
  TASK_CATEGORIES,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  type Attachment,
  type CreateTaskPayload,
  type Task,
  type TaskPriority,
  type TaskRecurrence,
} from '@/types/task';

const props = defineProps<{ loading: boolean; task?: Task | null }>();
const emit = defineEmits<{ submit: [payload: CreateTaskPayload] }>();
const open = defineModel<boolean>({ required: true });

const notifier = useNotifier();
const TITLE_MAX = 150;
const DESCRIPTION_MAX = 4000;

const isEdit = computed(() => Boolean(props.task));

const priorityItems = TASK_PRIORITIES.map((value) => ({ value, title: PRIORITY_LABELS[value] }));
const categoryItems = [...TASK_CATEGORIES];
const recurrenceItems = TASK_RECURRENCES.map((value) => ({ value, title: RECURRENCE_LABELS[value] }));

const formRef = ref<{ validate: () => Promise<{ valid: boolean }>; resetValidation: () => void } | null>(null);
const title = ref('');
const description = ref('');
const priority = ref<TaskPriority>('MEDIUM');
const category = ref<string | null>(null);
const dueDate = ref('');
const recurrence = ref<TaskRecurrence>('NONE');

// Adjuntos (solo en modo edición, cuando la tarea ya existe).
const attachments = ref<Attachment[]>([]);
const attLoading = ref(false);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const titleRules = [
  (v: string) => v.trim().length > 0 || 'El título es obligatorio',
  (v: string) => v.trim().length <= TITLE_MAX || `Máximo ${TITLE_MAX} caracteres`,
];
const descriptionRules = [(v: string) => v.length <= DESCRIPTION_MAX || `Máximo ${DESCRIPTION_MAX} caracteres`];

// Al abrir: precarga los datos de la tarea en modo edición, o limpia en modo creación.
watch(open, (isOpen) => {
  if (isOpen) {
    title.value = props.task?.title ?? '';
    description.value = props.task?.description ?? '';
    priority.value = props.task?.priority ?? 'MEDIUM';
    category.value = props.task?.category ?? null;
    dueDate.value = props.task?.dueDate ?? '';
    recurrence.value = props.task?.recurrence ?? 'NONE';
    attachments.value = [];
    formRef.value?.resetValidation();
    if (props.task) void loadAttachments(props.task.id);
  } else {
    closePreview();
  }
});

async function loadAttachments(taskId: number): Promise<void> {
  attLoading.value = true;
  try {
    attachments.value = await tasksApi.listAttachments(taskId);
  } catch {
    /* secundario */
  } finally {
    attLoading.value = false;
  }
}

async function onPickFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !props.task) return;
  uploading.value = true;
  try {
    const att = await tasksApi.uploadAttachment(props.task.id, file);
    attachments.value = [att, ...attachments.value];
    notifier.success(`Adjunto "${att.originalName}" subido`);
  } catch (err) {
    notifier.error(getErrorMessage(err));
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function onDownload(att: Attachment): Promise<void> {
  try {
    await tasksApi.downloadAttachment(att);
  } catch (err) {
    notifier.error(getErrorMessage(err));
  }
}

// ----- Vista previa de adjuntos (sin descargar) -----
type PreviewKind = 'image' | 'pdf' | 'text' | 'other';
const preview = ref<{ att: Attachment; kind: PreviewKind; url: string; text: string } | null>(null);
const previewLoading = ref(false);

function previewKind(mime: string | null): PreviewKind {
  if (!mime) return 'other';
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  return 'other';
}

async function openPreview(att: Attachment): Promise<void> {
  const kind = previewKind(att.mimeType);
  previewLoading.value = true;
  try {
    const blob = await tasksApi.fetchAttachmentBlob(att);
    const url = URL.createObjectURL(blob);
    const text = kind === 'text' ? await blob.text() : '';
    preview.value = { att, kind, url, text };
  } catch (err) {
    notifier.error(getErrorMessage(err));
  } finally {
    previewLoading.value = false;
  }
}

function closePreview(): void {
  if (preview.value) URL.revokeObjectURL(preview.value.url);
  preview.value = null;
}

async function onRemoveAttachment(att: Attachment): Promise<void> {
  try {
    await tasksApi.removeAttachment(att.id);
    attachments.value = attachments.value.filter((a) => a.id !== att.id);
  } catch (err) {
    notifier.error(getErrorMessage(err));
  }
}

function fileIcon(mime: string | null): string {
  const kind = previewKind(mime);
  if (kind === 'image') return 'mdi-file-image-outline';
  if (kind === 'pdf') return 'mdi-file-pdf-box';
  if (kind === 'text') return 'mdi-file-document-outline';
  return 'mdi-file-outline';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function onSubmit(): Promise<void> {
  const result = await formRef.value?.validate();
  if (!result?.valid || props.loading) return;
  emit('submit', {
    title: title.value.trim(),
    description: description.value.trim() || null,
    priority: priority.value,
    category: category.value?.trim() || null,
    dueDate: dueDate.value || null,
    recurrence: recurrence.value,
  });
}
</script>

<template>
  <!-- v-dialog ya cierra con ESC y clic fuera; añadimos scrim con blur. -->
  <v-dialog
    :model-value="open && !preview"
    max-width="540"
    :persistent="loading"
    scrim="#0a0b14"
    class="task-dialog"
    @update:model-value="(v) => !v && !preview && (open = false)"
  >
    <div class="dlg glass" data-testid="task-form-dialog">
      <header class="dlg__head">
        <div class="dlg__badge"><v-icon :icon="isEdit ? 'mdi-pencil' : 'mdi-plus'" /></div>
        <div>
          <h2 class="dlg__title">{{ isEdit ? 'Editar tarea' : 'Nueva tarea' }}</h2>
          <p class="dlg__sub">
            {{ isEdit ? 'Modifica el título o la descripción.' : 'Completa los datos para registrar una tarea.' }}
          </p>
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
          rows="3"
          auto-grow
          data-testid="task-description"
        />

        <div class="dlg__grid">
          <v-select
            v-model="priority"
            :items="priorityItems"
            item-title="title"
            item-value="value"
            label="Prioridad"
            prepend-inner-icon="mdi-flag-outline"
            :disabled="loading"
            hide-details
            data-testid="task-priority"
          />
          <v-combobox
            v-model="category"
            :items="categoryItems"
            label="Categoría (opcional)"
            prepend-inner-icon="mdi-tag-outline"
            :disabled="loading"
            clearable
            hide-details
            data-testid="task-category"
          />
        </div>
        <div class="dlg__grid mt-3">
          <v-text-field
            v-model="dueDate"
            type="date"
            label="Fecha de vencimiento (opcional)"
            prepend-inner-icon="mdi-calendar-alert"
            :disabled="loading"
            hide-details
            data-testid="task-duedate"
          />
          <v-select
            v-model="recurrence"
            :items="recurrenceItems"
            item-title="title"
            item-value="value"
            label="Repetir"
            prepend-inner-icon="mdi-repeat"
            :disabled="loading"
            hide-details
            data-testid="task-recurrence"
          />
        </div>

        <!-- Adjuntos: solo cuando la tarea ya existe (modo edición) -->
        <div v-if="isEdit" class="attach">
          <div class="attach__head">
            <span><v-icon icon="mdi-paperclip" size="16" /> Adjuntos</span>
            <button type="button" class="attach__add" :disabled="uploading" @click="fileInput?.click()">
              <v-progress-circular v-if="uploading" indeterminate size="14" width="2" />
              <template v-else><v-icon icon="mdi-upload" size="15" /> Subir archivo</template>
            </button>
            <input ref="fileInput" type="file" class="d-none" data-testid="attach-input" @change="onPickFile" />
          </div>
          <div v-if="attLoading" class="attach__empty">Cargando…</div>
          <ul v-else-if="attachments.length" class="attach__list">
            <li v-for="a in attachments" :key="a.id" class="attach__item">
              <v-icon :icon="fileIcon(a.mimeType)" size="18" />
              <button
                type="button"
                class="attach__name"
                :title="`Vista previa de ${a.originalName}`"
                @click="openPreview(a)"
              >
                {{ a.originalName }}
              </button>
              <span class="attach__size">{{ formatSize(a.size) }}</span>
              <button type="button" class="attach__act" aria-label="Descargar" title="Descargar" @click="onDownload(a)">
                <v-icon icon="mdi-download" size="16" />
              </button>
              <button type="button" class="attach__del" aria-label="Eliminar adjunto" @click="onRemoveAttachment(a)">
                <v-icon icon="mdi-close" size="15" />
              </button>
            </li>
          </ul>
          <p v-else class="attach__empty">Sin archivos adjuntos.</p>
        </div>

        <div class="dlg__actions">
          <v-btn variant="text" :disabled="loading" @click="open = false">Cancelar</v-btn>
          <v-btn
            type="submit"
            class="btn-accent"
            :loading="loading"
            prepend-icon="mdi-content-save"
            data-testid="task-submit"
          >
            {{ isEdit ? 'Guardar cambios' : 'Guardar tarea' }}
          </v-btn>
        </div>
      </v-form>
    </div>
  </v-dialog>

  <!-- Vista previa del adjunto (sin descargar) — por encima del diálogo de edición -->
  <v-dialog
    :model-value="Boolean(preview)"
    max-width="860"
    :z-index="2600"
    scrim="rgba(0,0,0,0.6)"
    @update:model-value="(v) => !v && closePreview()"
  >
    <div v-if="preview" class="pv">
      <header class="pv__head">
        <div class="pv__title">
          <v-icon :icon="fileIcon(preview.att.mimeType)" size="20" />
          <span :title="preview.att.originalName">{{ preview.att.originalName }}</span>
        </div>
        <div class="pv__tools">
          <v-btn size="small" variant="tonal" prepend-icon="mdi-download" @click="onDownload(preview.att)">
            Descargar
          </v-btn>
          <button type="button" class="pv__close" aria-label="Cerrar" @click="closePreview">
            <v-icon icon="mdi-close" />
          </button>
        </div>
      </header>
      <div class="pv__body">
        <img v-if="preview.kind === 'image'" :src="preview.url" :alt="preview.att.originalName" class="pv__img" />
        <iframe
          v-else-if="preview.kind === 'pdf'"
          :src="preview.url"
          class="pv__frame"
          :title="preview.att.originalName"
        ></iframe>
        <pre v-else-if="preview.kind === 'text'" class="pv__text">{{ preview.text }}</pre>
        <div v-else class="pv__other">
          <v-icon icon="mdi-file-question-outline" size="48" />
          <p>No hay vista previa para este tipo de archivo.</p>
          <v-btn class="btn-accent" prepend-icon="mdi-download" @click="onDownload(preview.att)">Descargar</v-btn>
        </div>
      </div>
    </div>
  </v-dialog>

  <v-overlay :model-value="previewLoading" :z-index="2700" class="align-center justify-center" persistent>
    <v-progress-circular indeterminate size="48" color="primary" />
  </v-overlay>
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
.dlg__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}
@media (max-width: 480px) {
  .dlg__grid {
    grid-template-columns: 1fr;
  }
}
.dlg__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-5);
}

/* Adjuntos */
.attach {
  margin-top: var(--sp-4);
  border-top: 1px solid var(--surface-border);
  padding-top: var(--sp-3);
}
.attach__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: var(--text-strong);
  font-size: var(--fs-sm);
}
.attach__add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  background: var(--glass-highlight);
  border: 1px solid var(--surface-border);
  color: var(--accent-1);
  font-weight: 600;
  font-size: var(--fs-xs);
  cursor: pointer;
}
.attach__add:hover {
  background: color-mix(in srgb, var(--accent-1) 9%, transparent);
}
.attach__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
}
.attach__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  background: var(--glass-highlight);
}
.attach__name {
  flex: 1;
  min-width: 0;
  text-align: left;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--accent-1);
  font-size: var(--fs-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attach__name:hover {
  text-decoration: underline;
}
.attach__size {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  flex-shrink: 0;
}
.attach__act,
.attach__del {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  flex-shrink: 0;
}
.attach__act:hover {
  color: var(--accent-1);
}
.attach__del:hover {
  color: #dc2626;
}

/* Vista previa */
.pv {
  background: var(--surface-solid);
  border-radius: var(--radius-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 86vh;
}
.pv__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-3) var(--sp-4);
  border-bottom: 1px solid var(--surface-border);
}
.pv__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--text-strong);
  min-width: 0;
}
.pv__title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pv__tools {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 0;
}
.pv__close {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
}
.pv__close:hover {
  color: var(--text-strong);
}
.pv__body {
  padding: var(--sp-4);
  overflow: auto;
  background: var(--bg-base);
}
.pv__img {
  display: block;
  max-width: 100%;
  margin: 0 auto;
  border-radius: var(--radius-sm);
}
.pv__frame {
  width: 100%;
  height: 70vh;
  border: none;
  border-radius: var(--radius-sm);
  background: #fff;
}
.pv__text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: var(--fs-sm);
  color: var(--text-strong);
  background: var(--surface-solid);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  padding: var(--sp-3);
  max-height: 68vh;
  overflow: auto;
}
.pv__other {
  display: grid;
  justify-items: center;
  gap: var(--sp-3);
  padding: var(--sp-6);
  color: var(--text-muted);
  text-align: center;
}
.attach__empty {
  margin: 8px 0 0;
  font-size: var(--fs-sm);
  color: var(--text-muted);
}
</style>

<style>
/* Desenfoque del fondo del diálogo (scrim) */
.task-dialog .v-overlay__scrim {
  backdrop-filter: blur(6px);
  opacity: 0.55 !important;
}
</style>
