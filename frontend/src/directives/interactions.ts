import type { App, Directive } from 'vue';

const finePointer = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
const reduced = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* -----------------------------------------------------------------------------
   v-tilt — inclinación 3D + spotlight siguiendo al puntero.
   Usa un único listener por elemento y rAF para evitar layout thrashing (60 FPS).
   Opciones: v-tilt="{ max: 8, scale: 1.01, glare: true }"
----------------------------------------------------------------------------- */
interface TiltOpts {
  max?: number;
  scale?: number;
  glare?: boolean;
}
interface TiltEl extends HTMLElement {
  __tilt?: () => void;
}

const tilt: Directive<TiltEl, TiltOpts | undefined> = {
  mounted(el, binding) {
    if (!finePointer() || reduced()) return;
    const { max = 8, scale = 1.01, glare = true } = binding.value ?? {};
    el.classList.add('tilt');
    if (glare) el.classList.add('spotlight');

    let raf = 0;
    let rect = el.getBoundingClientRect();
    const refresh = (): void => {
      rect = el.getBoundingClientRect();
    };

    const onMove = (e: PointerEvent): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        el.style.setProperty('--rx', `${(px - 0.5) * max * 2}deg`);
        el.style.setProperty('--ry', `${-(py - 0.5) * max * 2}deg`);
        el.style.setProperty('--mx', `${px * 100}%`);
        el.style.setProperty('--my', `${py * 100}%`);
      });
    };
    const onEnter = (): void => {
      refresh();
      el.style.setProperty('--spot', '1');
      el.style.transform = `perspective(900px) rotateX(var(--ry,0)) rotateY(var(--rx,0)) scale(${scale})`;
    };
    const onLeave = (): void => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--spot', '0');
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.style.transform = '';
    };

    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    window.addEventListener('scroll', refresh, { passive: true });
    window.addEventListener('resize', refresh);
    el.__tilt = () => {
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', refresh);
      window.removeEventListener('resize', refresh);
      cancelAnimationFrame(raf);
    };
  },
  unmounted(el) {
    el.__tilt?.();
  },
};

/* -----------------------------------------------------------------------------
   v-spotlight — solo la luz de seguimiento (sin tilt), para superficies grandes.
----------------------------------------------------------------------------- */
interface SpotEl extends HTMLElement {
  __spot?: () => void;
}
const spotlight: Directive<SpotEl> = {
  mounted(el) {
    if (!finePointer()) return;
    el.classList.add('spotlight');
    let raf = 0;
    let rect = el.getBoundingClientRect();
    const onMove = (e: PointerEvent): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        rect = el.getBoundingClientRect();
        el.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
        el.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
      });
    };
    const on = (): void => el.style.setProperty('--spot', '1');
    const off = (): void => {
      el.style.setProperty('--spot', '0');
      cancelAnimationFrame(raf);
    };
    el.addEventListener('pointerenter', on);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', off);
    el.__spot = () => {
      el.removeEventListener('pointerenter', on);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', off);
    };
  },
  unmounted(el) {
    el.__spot?.();
  },
};

/* -----------------------------------------------------------------------------
   v-reveal — entrada en cascada con IntersectionObserver.
   v-reveal="120"  -> retardo en ms (stagger). Se revela una sola vez.
----------------------------------------------------------------------------- */
interface RevealEl extends HTMLElement {
  __io?: IntersectionObserver;
}
let sharedObserver: IntersectionObserver | null = null;
const getObserver = (): IntersectionObserver => {
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries, obs) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            obs.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
  }
  return sharedObserver;
};

const reveal: Directive<RevealEl, number | undefined> = {
  mounted(el, binding) {
    el.classList.add('reveal');
    if (binding.value) el.style.setProperty('--reveal-delay', `${binding.value}ms`);
    if (reduced()) {
      el.classList.add('is-visible');
      return;
    }
    getObserver().observe(el);
  },
  unmounted(el) {
    sharedObserver?.unobserve(el);
  },
};

export function registerInteractions(app: App): void {
  app.directive('tilt', tilt);
  app.directive('spotlight', spotlight);
  app.directive('reveal', reveal);
}
