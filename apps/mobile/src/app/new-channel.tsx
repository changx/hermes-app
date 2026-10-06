import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ConnectionScope, FormKeyboardAvoidingView, Notice, channelRoute, useApp, useConnections } from '../App';
import { NewChannelEditor } from '../EditorScreens';
import { Text } from '../FontSize';

function Editor({ onCreated }: { onCreated: (channelId: string) => void }) {
  const { client } = useApp();
  if (!client) return <Notice text="This connection is unavailable." />;
  return <NewChannelEditor client={client} onCreated={onCreated} />;
}

/**
 * The destination Hermes is always visible. With several connections the
 * user must choose it; it never follows another page's connection.
 */
export default function NewChannel() {
  const { connections } = useConnections();
  const router = useRouter();
  const usable = connections.filter(c => c.config);
  const [chosen, setChosen] = useState<string | null>(usable.length === 1 ? usable[0].slot : null);
  const target = usable.find(c => c.slot === chosen);
  if (!usable.length) return <Notice text="Add a connection before creating a channel." />;
  return <SafeAreaView style={{ flex: 1 }} edges={['bottom', 'left', 'right']}>
    <FormKeyboardAvoidingView>
      <View style={styles.target} accessibilityRole="radiogroup" accessibilityLabel="Create in">
        <Text style={styles.caption}>Create in</Text>
        <View style={styles.options}>{usable.map(c => {
          const selected = c.slot === chosen, online = c.status === 'online';
          return <Pressable key={c.slot} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !online }}
            accessibilityLabel={online ? c.name : `${c.name}, unavailable`} disabled={!online || usable.length === 1}
            onPress={() => setChosen(c.slot)} style={[styles.option, selected && styles.selected, !online && styles.disabled]}>
            <Text style={[styles.optionText, selected && styles.selectedText]} numberOfLines={1}>{c.name}</Text>
          </Pressable>;
        })}</View>
        {!target && <Text style={styles.hint}>Choose the Hermes for this channel.</Text>}
        {target && target.status !== 'online' && <Text style={styles.hint}>This connection is unavailable. Choose another or try again later.</Text>}
      </View>
      {target ? <ConnectionScope key={target.slot} slot={target.slot}>
        <Editor onCreated={channelId => router.replace(channelRoute(target.slot, channelId))} />
      </ConnectionScope> : null}
    </FormKeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  target: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  caption: { color: '#607187', fontSize: 13 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: '#cdd7e3', backgroundColor: '#fff', justifyContent: 'center', maxWidth: '100%' },
  selected: { backgroundColor: '#2960ad', borderColor: '#2960ad' }, disabled: { opacity: 0.5 },
  optionText: { color: '#172a40', fontSize: 14 }, selectedText: { color: '#fff', fontWeight: '600' },
  hint: { color: '#607187', fontSize: 13 },
});
