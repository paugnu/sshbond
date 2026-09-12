import { TOUCH_SCROLL_JS } from './touchScroll';
import { TerminalPalette } from '../../theme/colors';
import { XTERM_CSS, XTERM_FIT_ADDON_JS, XTERM_JS } from './xtermAssets';

/**
 * Builds the terminal document.
 *
 * xterm is inlined rather than loaded from a CDN: a terminal that needs the
 * public internet to render cannot be used to reach a machine on the local
 * network, and every session open would otherwise be an outbound request.
 */
export function buildTerminalHtml(options: {
  palette: TerminalPalette;
  fontSize: number;
  fontFamily: string;
  cursorStyle: string;
}): string {
  const { palette, fontSize, fontFamily, cursorStyle } = options;

  // xterm 5 renamed `selection` to `selectionBackground`; passing the old key
  // silently leaves selections unstyled.
  const { selection, ...paletteRest } = palette;
  const theme = { ...paletteRest, selectionBackground: selection };

  // Every value crossing into the page is JSON-encoded rather than
  // interpolated: a font family containing a quote would otherwise break out
  // of the string and corrupt the script.
  const config = JSON.stringify({
    cursorBlink: true,
    cursorStyle,
    fontSize,
    fontFamily,
    theme,
    allowProposedApi: true,
    scrollback: 5000,
    macOptionIsMeta: true,
  });

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>${XTERM_CSS}</style>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background-color: ${JSON.stringify(palette.background)};
      overflow: hidden;
    }
    #terminal { width: 100%; height: 100%; padding: 4px; }
    .xterm { height: 100%; }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>${XTERM_JS}</script>
  <script>${XTERM_FIT_ADDON_JS}</script>
  <script>
    ${TOUCH_SCROLL_JS}
    (function () {
      var post = function (message) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      };

      var term = new Terminal(${config});
      var fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal'));
      installTouchScroll(term, document.getElementById('terminal'));

      var fit = function () {
        var element = document.getElementById('terminal');
        // A hidden/background WebView can temporarily report zero bounds.
        // Fitting then would send a tiny PTY size to the remote process.
        if (document.hidden || !element || element.clientWidth < 40 || element.clientHeight < 40) return;
        try { fitAddon.fit(); } catch (e) { /* element not laid out yet */ }
      };
      fit();

      term.onData(function (data) { post({ type: 'input', data: data }); });
      term.onResize(function (size) { post({ type: 'resize', cols: size.cols, rows: size.rows }); });

      window.addEventListener('resize', fit);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) fit(); });
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', fit);
      }

      window.writeTerminal = function (chunk) { term.write(chunk); };
      window.clearTerminal = function () { term.clear(); };
      window.focusTerminal = function () { term.focus(); };
      window.blurTerminal = function () { term.blur(); };
      window.fitTerminal = fit;

      // Tells React Native the emulator is live and safe to write to.
      post({ type: 'ready', cols: term.cols, rows: term.rows });
    })();
  </script>
</body>
</html>`;
}

