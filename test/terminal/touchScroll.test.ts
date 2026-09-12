import { runInNewContext } from 'node:vm';
import { TOUCH_SCROLL_JS } from '../../src/features/terminal/touchScroll';

function setup() {
  let now = 0, nextFrame = 1;
  const frames = new Map<number, (time: number) => void>();
  const handlers: Record<string, (event: any) => void> = {};
  const viewport = { scrollTop: 500, scrollHeight: 2000, clientHeight: 500 };
  const document: any = { hidden: false, addEventListener: (name: string, fn: any) => { handlers[name] = fn; } };
  const term = { buffer: { active: { type: 'normal' } }, modes: { mouseTrackingMode: 'none' } };
  const element = { querySelector: () => viewport, addEventListener: (name: string, fn: any) => { handlers[name] = fn; } };
  const context: any = { document, window: { addEventListener: (name: string, fn: any) => { handlers[name] = fn; } },
    performance: { now: () => now },
    requestAnimationFrame: (fn: any) => { const id = nextFrame++; frames.set(id, fn); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  runInNewContext(TOUCH_SCROLL_JS, context);
  context.installTouchScroll(term, element);
  function event(type: string, y = 100, touches = 1) {
    now += 16;
    const e = { touches: Array.from({ length: touches }, (_, identifier) => ({ identifier, clientY: y })), cancelable: true,
      preventDefault: jest.fn(), stopImmediatePropagation: jest.fn() };
    handlers[type](e); return e;
  }
  function frame() { now += 16; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); }
  return { event, frame, viewport, frames, document, term, handlers };
}

it('batches finger movements into one frame and continues with bounded inertia', () => {
  const s = setup();
  s.event('touchstart', 100);
  expect(s.event('touchmove', 120).preventDefault).toHaveBeenCalled();
  s.event('touchmove', 140);
  expect(s.viewport.scrollTop).toBe(500);
  expect(s.frames.size).toBe(1);
  s.frame();
  expect(s.viewport.scrollTop).toBe(460);
  s.event('touchend', 140, 0); s.frame();
  expect(s.viewport.scrollTop).toBeLessThan(460);
  for (let i = 0; i < 160; i++) s.frame();
  expect(s.frames.size).toBe(0);
  expect(s.viewport.scrollTop).toBeGreaterThanOrEqual(0);
});

it('keeps taps available, suppresses synthetic clicks after a drag, and stops on a new touch', () => {
  const s = setup();
  s.event('touchstart');
  expect(s.event('touchmove', 102).preventDefault).not.toHaveBeenCalled();
  expect(s.event('touchend', 102, 0).preventDefault).not.toHaveBeenCalled();
  s.event('touchstart', 100); s.event('touchmove', 130); s.frame();
  s.event('touchend', 130, 0);
  expect(s.event('click').preventDefault).toHaveBeenCalled();
  s.event('touchstart');
  expect(s.frames.size).toBe(0);
});

it('owns the gesture at boundaries and cancels motion when backgrounded', () => {
  const s = setup(); s.viewport.scrollTop = 0;
  s.event('touchstart', 100);
  expect(s.event('touchmove', 150).preventDefault).toHaveBeenCalled();
  s.frame(); expect(s.viewport.scrollTop).toBe(0);
  s.event('touchend', 150, 0); s.frame(); expect(s.frames.size).toBe(0);
  s.viewport.scrollTop = 500;
  s.event('touchstart', 100); s.event('touchmove', 150);
  s.document.hidden = true; s.handlers.visibilitychange({});
  s.frame(); expect(s.viewport.scrollTop).toBe(500);
});

it('leaves mouse-reporting apps, alternate buffers and multiple fingers to xterm', () => {
  const s = setup();
  s.term.modes.mouseTrackingMode = 'vt200';
  expect(s.event('touchstart').stopImmediatePropagation).not.toHaveBeenCalled();
  s.term.modes.mouseTrackingMode = 'none'; s.term.buffer.active.type = 'alternate';
  expect(s.event('touchstart').stopImmediatePropagation).not.toHaveBeenCalled();
  s.term.buffer.active.type = 'normal';
  expect(s.event('touchstart', 100, 2).stopImmediatePropagation).not.toHaveBeenCalled();
});
