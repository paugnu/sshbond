import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { useTheme } from '../../theme/ThemeContext';
import { ISSHConnection } from '@/services/ssh/SSHConnection';
import { buildTerminalHtml } from './terminalDocument';

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
