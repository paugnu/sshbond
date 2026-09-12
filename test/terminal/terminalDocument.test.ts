import { runInNewContext } from 'node:vm';
import { XTERM_FIT_ADDON_JS } from '../../src/features/terminal/xtermAssets';
import { buildTerminalHtml } from '../../src/features/terminal/terminalDocument';
import { terminalPalettes } from '../../src/theme/colors';

it('does not resize the remote PTY while hidden and refits on return', () => {
  const element = { clientWidth: 800, clientHeight: 600 };
  const events: Record<string, () => void> = {};
  const messages: any[] = [];
  let term: any;
  const document = {
    hidden: false,
    getElementById: () => element,
    addEventListener: (name: string, callback: () => void) => { events[name] = callback; },
  };
  class Terminal {
    cols = 80; rows = 24;
    resizeListener?: (size: any) => void;
    constructor() { term = this; }
    element = { parentElement: element };
    options = { scrollback: 0 };
    _core = { _renderService: { dimensions: { css: { cell: { width: 10, height: 20 } } }, clear() {} } };
    loadAddon(addon: any) { addon.activate(this); }
    open() {} onData() {}
    resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; this.resizeListener?.({ cols, rows }); }
    onResize(callback: (size: any) => void) { this.resizeListener = callback; }
  }
  const window = {
    getComputedStyle: (target: unknown) => ({ getPropertyValue: (name: string) => {
      if (target !== element) return '0';
      return String(name === 'width' ? element.clientWidth : element.clientHeight);
    } }),
    ReactNativeWebView: { postMessage: (text: string) => messages.push(JSON.parse(text)) },
    addEventListener: (name: string, callback: () => void) => { events[name] = callback; },
  };
  const html = buildTerminalHtml({ palette: terminalPalettes.nord, fontSize: 14, fontFamily: 'monospace', cursorStyle: 'block' });
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const context: any = { window, document, Terminal };
  context.self = context;
  runInNewContext(XTERM_FIT_ADDON_JS + '\n' + script, context);
  expect(messages).toEqual([{ type: 'ready', cols: 80, rows: 30 }]);
  messages.length = 0;
  // Background WebViews can report zero frames, then receive delayed resize events.
  document.hidden = true;
  element.clientWidth = 0; element.clientHeight = 0;
  events.resize(); events.visibilitychange();
  document.hidden = false;
  events.resize();
  expect(messages).toEqual([]);
  expect([term.cols, term.rows]).toEqual([80, 30]);
  element.clientWidth = 600; element.clientHeight = 400;
  events.visibilitychange();
  expect(messages).toEqual([{ type: 'resize', cols: 60, rows: 20 }]);
});
