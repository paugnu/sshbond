import React, { createContext, forwardRef, useCallback, useContext, useRef, useEffect } from 'react';
import { Keyboard, Platform, ScrollView, ScrollViewProps, TextInput, TextInputProps } from 'react-native';

const FocusContext = createContext<(input: TextInput | null) => void>(() => {});

/** Scroll the focused field into the visible viewport, including after keyboard resizing. */
export function FormScrollView({ children, onScroll, onLayout, ...props }: ScrollViewProps) {
  const scroll = useRef<ScrollView>(null);
  const focused = useRef<TextInput | null>(null);
  const offset = useRef(0);
  const reveal = useCallback(() => {
    requestAnimationFrame(() => {
      const input = focused.current;
      if (!input?.isFocused()) return;
      scroll.current?.getNativeScrollRef()?.measureInWindow((_x, top, _w, height) => {
        input.measureInWindow((_ix, y, _iw, h) => {
          if (!input.isFocused() || height <= 0) return;
          const bottom = y + Math.min(h, Math.max(0, height - 24));
          const delta = y < top + 12 ? y - top - 12 : Math.max(0, bottom - (top + height - 12));
          if (delta) scroll.current?.scrollTo({ y: Math.max(0, offset.current + delta), animated: true });
        });
      });
    });
  }, []);
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', reveal);
    return () => subscription.remove();
  }, [reveal]);
  return (
    <FocusContext.Provider value={input => { focused.current = input; reveal(); }}>
      <ScrollView {...props} ref={scroll} keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        scrollEventThrottle={16}
        onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; onScroll?.(event); }}
        onLayout={event => { onLayout?.(event); reveal(); }}>
        {children}
      </ScrollView>
    </FocusContext.Provider>
  );
}

export const FormInput = forwardRef<TextInput, TextInputProps>(function FormInput(props, forwardedRef) {
  const input = useRef<TextInput | null>(null);
  const reveal = useContext(FocusContext);
  return <TextInput {...props} ref={node => {
    input.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }}
    returnKeyType={props.returnKeyType ?? (props.multiline ? 'default' : 'done')}
    onSubmitEditing={props.onSubmitEditing ?? (props.multiline ? undefined : Keyboard.dismiss)}
    onFocus={event => { reveal(input.current); props.onFocus?.(event); }} />;
});
