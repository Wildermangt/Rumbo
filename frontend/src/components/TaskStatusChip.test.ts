import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TaskStatusChip from './TaskStatusChip.vue';

// Stub de v-icon (no cargamos Vuetify en pruebas unitarias).
const global = { stubs: { 'v-icon': true } };

describe('TaskStatusChip', () => {
  it('muestra "Completada" con la clase done', () => {
    const w = mount(TaskStatusChip, { props: { status: 'COMPLETED' }, global });
    expect(w.text()).toContain('Completada');
    expect(w.find('.chip').classes()).toContain('done');
  });

  it('muestra "Pendiente" con la clase pending', () => {
    const w = mount(TaskStatusChip, { props: { status: 'PENDING' }, global });
    expect(w.text()).toContain('Pendiente');
    expect(w.find('.chip').classes()).toContain('pending');
  });
});
