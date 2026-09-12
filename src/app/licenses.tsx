import { FormInput as TextInput } from '../features/common/FormControls';
import { DismissKeyboardButton } from '../features/common/KeyboardAwareModal';
import React, { useState } from 'react';
import { FlatList, ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../theme/ThemeContext';
import notices from '../generated/licenseNotices.json';

export default function LicensesScreen() {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<(typeof notices)[number] | null>(null);
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: 'Open-source licenses' }} />
      {selected ? (
        <>
          <TouchableOpacity accessibilityRole="button" onPress={() => setSelected(null)} style={styles.button}>
            <Text style={{ color: colors.text }}>Back to license list</Text>
          </TouchableOpacity>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={[styles.title, { color: colors.text }]}>{selected.name}</Text>
            <Text selectable style={[styles.body, { color: colors.text }]}>{selected.text}</Text>
          </ScrollView>
        </>
      ) : (
        <>
          <TextInput accessibilityLabel="Search open-source licenses" placeholder="Search libraries" placeholderTextColor={colors.textSubtle}
            value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false}
            style={[styles.search, { color: colors.text, borderColor: colors.border }]} />
          <DismissKeyboardButton color={colors.primary} />
          <FlatList automaticallyAdjustKeyboardInsets keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" data={notices.filter(n => n.name.toLowerCase().includes(query.toLowerCase()))}
            keyExtractor={n => n.name} contentContainerStyle={styles.content}
            renderItem={({ item }) => (
              <TouchableOpacity accessibilityRole="button" onPress={() => setSelected(item)} style={[styles.button, { borderBottomColor: colors.border, borderBottomWidth: 1 }]}>
                <Text style={{ color: colors.text }}>{item.name}</Text>
              </TouchableOpacity>
            )} />
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  button: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 14, justifyContent: 'center' },
  search: { minHeight: 48, margin: 16, padding: 12, borderWidth: 1, borderRadius: 8 },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  body: { fontSize: 14, lineHeight: 21 },
});
