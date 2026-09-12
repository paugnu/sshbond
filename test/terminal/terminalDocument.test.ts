import { runInNewContext } from 'node:vm';
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
    loadAddon() {} open() {} onData() {}
    onResize(callback: (size: any) => void) { this.resizeListener = callback; }
  }
  class FitAddon {
    fit() {
      term.cols = Math.max(2, Math.floor(element.clientWidth / 10));
      term.rows = Math.max(1, Math.floor(element.clientHeight / 20));
      term.resizeListener?.({ cols: term.cols, rows: term.rows });
    }
  }
  const window = {
    ReactNativeWebView: { postMessage: (text: string) => messages.push(JSON.parse(text)) },
    addEventListener: (name: string, callback: () => void) => { events[name] = callback; },
  };
  const html = buildTerminalHtml({ palette: terminalPalettes.nord, fontSize: 14, fontFamily: 'monospace', cursorStyle: 'block' });
  const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  runInNewContext(script, { window, document, Terminal, FitAddon: { FitAddon } });
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
