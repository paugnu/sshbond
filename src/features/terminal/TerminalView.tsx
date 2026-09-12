import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useTheme } from '../../theme/ThemeContext';
import { ISSHConnection } from '@/services/ssh/SSHConnection';
import { TerminalPalette } from '../../theme/colors';
import { XTERM_CSS, XTERM_FIT_ADDON_JS, XTERM_JS } from './xtermAssets';

interface TerminalViewProps {
  connection: ISSHConnection;
  fontSize?: number;
  fontFamily?: string;
  cursorStyle?: 'block' | 'underline' | 'bar';
}

export interface TerminalHandle {
  focus: () => void;
  blur: () => void;
  clear: () => void;
  /** Re-measures the grid, after the view's own height has changed. */
  fit: () => void;
}

/**
 * Builds the terminal document.
 *
 * xterm is inlined rather than loaded from a CDN: a terminal that needs the
 * public internet to render cannot be used to reach a machine on the local
 * network, and every session open would otherwise be an outbound request.
 */
function buildTerminalHtml(options: {
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
    (function () {
      var post = function (message) {
        window.ReactNativeWebView.postMessage(JSON.stringify(message));
      };

      var term = new Terminal(${config});
      var fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(document.getElementById('terminal'));

      var fit = function () {
        try { fitAddon.fit(); } catch (e) { /* element not laid out yet */ }
      };
      fit();

      term.onData(function (data) { post({ type: 'input', data: data }); });
      term.onResize(function (size) { post({ type: 'resize', cols: size.cols, rows: size.rows }); });

      window.addEventListener('resize', fit);
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

export const TerminalView = React.forwardRef<TerminalHandle, TerminalViewProps>(
  ({ connection, fontSize = 14, fontFamily = 'Menlo, Monaco, monospace', cursorStyle = 'block' }, ref) => {
    const { terminalPalette } = useTheme();
    const webViewRef = useRef<WebView>(null);

    // Output that arrives before the WebView has finished loading -- the login
    // banner and first prompt, typically -- would be dropped without this.
    const isReadyRef = useRef(false);
    const pendingRef = useRef<string[]>([]);

    const html = useMemo(
      () =>
        buildTerminalHtml({
          palette: terminalPalette,
          fontSize,
          fontFamily,
          cursorStyle,
        }),
      [terminalPalette, fontSize, fontFamily, cursorStyle]
    );

    // A new document means a new emulator instance, so anything buffered for
    // the previous one must not be replayed into it.
    useEffect(() => {
      isReadyRef.current = false;
      pendingRef.current = [];
    }, [html]);

    const write = useCallback((chunk: string) => {
      if (!isReadyRef.current) {
        pendingRef.current.push(chunk);
        return;
      }
      webViewRef.current?.injectJavaScript(
        `window.writeTerminal(${JSON.stringify(chunk)}); true;`
      );
    }, []);

    React.useImperativeHandle(ref, () => ({
      focus: () => webViewRef.current?.injectJavaScript('window.focusTerminal(); true;'),
      blur: () => webViewRef.current?.injectJavaScript('window.blurTerminal(); true;'),
      clear: () => webViewRef.current?.injectJavaScript('window.clearTerminal(); true;'),
      // The WebView refits itself when the page resizes, but a native frame
      // change -- the keyboard opening under it -- does not always reach the
      // page as a resize event on iOS.
      fit: () => webViewRef.current?.injectJavaScript('window.fitTerminal(); true;'),
    }));

    useEffect(() => connection.onData(write), [connection, write]);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let message: { type?: string; data?: string; cols?: number; rows?: number };
        try {
          message = JSON.parse(event.nativeEvent.data);
        } catch {
          return;
        }

        switch (message.type) {
          case 'ready': {
            isReadyRef.current = true;
            const buffered = pendingRef.current.join('');
            pendingRef.current = [];
            if (buffered) write(buffered);
            if (message.cols && message.rows) {
              void connection.resize(message.cols, message.rows).catch(() => undefined);
            }
            break;
          }
          case 'input':
            if (message.data !== undefined) {
              // A keystroke sent while the session is down must not surface as
              // an unhandled rejection.
              void connection.sendInput(message.data).catch(() => undefined);
            }
            break;
          case 'resize':
            if (message.cols && message.rows) {
              void connection.resize(message.cols, message.rows).catch(() => undefined);
            }
            break;
        }
      },
      [connection, write]
    );

    return (
      <View style={[styles.container, { backgroundColor: terminalPalette.background }]}>
        <WebView
          ref={webViewRef}
          originWhitelist={['about:blank']}
          source={{ html }}
          onMessage={handleMessage}
          style={{ backgroundColor: terminalPalette.background }}
          scrollEnabled={false}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          // Nothing in the document is remote; blocking navigation keeps a
          // stray link in terminal output from replacing the emulator.
          onShouldStartLoadWithRequest={request => request.url === 'about:blank'}
          javaScriptEnabled
          domStorageEnabled={false}
        />
      </View>
    );
  }
);

TerminalView.displayName = 'TerminalView';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
