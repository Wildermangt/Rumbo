import { onUnmounted, ref, watch, type Ref } from 'vue';

const prefersReduced = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Contador numérico animado (count-up) con requestAnimationFrame.
 * Devuelve un ref con el valor mostrado, que transiciona suavemente al cambiar `target`.
 */
export function useCountUp(target: Ref<number>, duration = 900): Ref<number> {
  const display = ref(target.value);
  let raf = 0;

  function animate(to: number): void {
    cancelAnimationFrame(raf);
    if (prefersReduced()) {
      display.value = to;
      return;
    }
    const from = display.value;
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min((now - start) / duration, 1);
      // easeOutExpo
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      display.value = Math.round(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  watch(target, (v) => animate(v), { immediate: true });
  onUnmounted(() => cancelAnimationFrame(raf));

  return display;
}
