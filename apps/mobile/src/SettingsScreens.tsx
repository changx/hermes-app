import React from 'react';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { FontSizeSettings, Text, useFontSize } from './FontSize';
import { AgentNameSettings } from './AgentSettings';
import { ConnectionNameSettings } from './ConnectionNameSettings';
import { ModelSettings } from './ModelSettings';
import { AddConnectionForm, connectionDetail, connectionNeedsAttention, connectionStateLabel } from './ConnectionScreen';
import { SettingsBlock, SettingsPage, SettingsRow, SettingsSection } from './SettingsUI';
import { MAX_CONNECTIONS, serverName } from './connectionSlots';
import { useApp, useConnections } from './connections';

import { connectionSettingsRoute, envKeysSettingsRoute, profileFilesSettingsRoute, vaultSettingsRoute } from './settingsRoutes';
import { AppIconSettings, useAppIcon } from './AppIcon';
import { appIconLabel } from './appIconChoices';

/**
 * Level 1, the single Settings entry. Sections follow where a setting takes effect:
 * each connection (its own page), then this device for every connection.
 */
export function SettingsHome() {
  const router = useRouter();
  const { connections, listError } = useConnections();
  const { choice } = useFontSize();
  const appIcon = useAppIcon();
  const full = connections.length >= MAX_CONNECTIONS;
  return <SettingsPage>
    {!!listError && <Text accessibilityRole="alert" style={styles.error}>{listError}</Text>}
    <SettingsSection title="Connections" footer="Projects from all connections appear together on the home screen. Open a connection for its name, status, Agent, default model and removal.">
      {connections.map((row, index) => <SettingsRow key={row.slot} first={index === 0} title={row.name} detail={row.server ?? undefined}
        value={connectionStateLabel(row)} issue={connectionNeedsAttention(row)} onPress={() => router.push(connectionSettingsRoute(row.slot))} />)}
      <SettingsRow first={!connections.length} title="Add connection" value={full ? 'Limit reached' : undefined}
        onPress={() => router.push('/settings/add-connection')} />
    </SettingsSection>
    <SettingsSection title="This device" footer="Applies on this device to every connection.">
      <SettingsRow first title="Font size" value={choice} onPress={() => router.push('/settings/font-size')} />
      {appIcon.available && <SettingsRow title="App icon" value={appIconLabel(appIcon.current)} onPress={() => router.push('/settings/app-icon')} />}
    </SettingsSection>
  </SettingsPage>;
}

/**
 * Level 2: one connection, grouped by where each setting takes effect:
 * status, on this Hermes (every device), on this device (this connection only).
 */
export function ConnectionSettings() {
  const router = useRouter();
  const { removeConnection, renameConnection, connections } = useConnections();
  const { slot, config, client, agentName } = useApp();
  const row = connections.find(item => item.slot === slot);
  if (!row) return null;
  const detail = connectionDetail(row);
  const remove = () => Alert.alert(`Remove ${row.name}?`,
    'This removes this connection, its local drafts and queued messages from this device. Other connections and server conversations are unchanged.', [
      { text: 'Keep connection', style: 'cancel' },
      { text: row.status === 'pairing' ? 'Cancel pairing' : 'Remove connection', style: 'destructive', onPress: () => {
        // Route ownership pops this page once the connection is gone; do not navigate here too.
        removeConnection(slot).catch(() => Alert.alert('Could not confirm removal.', 'Check the connection list before trying again.'));
      } },
    ]);
  return <SettingsPage>
    <SettingsSection title="Status">
      <SettingsBlock first>
        <Text style={styles.key}>Server</Text><Text selectable style={styles.value}>{row.server ?? 'Saved server address unavailable'}</Text>
      </SettingsBlock>
      <SettingsBlock>
        <Text style={styles.key}>State</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.value, connectionNeedsAttention(row) && styles.issue]}>{connectionStateLabel(row)}</Text>
        {!!detail && <Text style={styles.hint}>{detail}</Text>}
      </SettingsBlock>
    </SettingsSection>
    {config && client && <SettingsSection title="On this Hermes · all your devices"
      footer="Conversations with their own model selection keep it. Running replies are not interrupted.">
      <SettingsBlock first>
        <Text style={styles.subhead}>Default model</Text>
        {row.status === 'online' || client.connectionState === 'online' ? <ModelSettings key={config.id} client={client} />
          : <Text style={styles.hint}>Model settings are available when this connection is online.</Text>}
      </SettingsBlock>
      {client.supportsVault && <SettingsRow title="Passwords & Logins" onPress={() => router.push(vaultSettingsRoute(slot))} />}
      {client.supportsEnvKeys && <SettingsRow title="API keys" onPress={() => router.push(envKeysSettingsRoute(slot))} />}
      {client.supportsProfileFiles && <SettingsRow title="Persona & memory" detail="SOUL.md, USER.md, MEMORY.md" onPress={() => router.push(profileFilesSettingsRoute(slot))} />}
    </SettingsSection>}
    {/* Connection name works in every state, including pairing; Agent name needs a paired identity. */}
    <SettingsSection title="On this device">
      <SettingsBlock first>
        <ConnectionNameSettings key={slot} customName={row.customName} defaultName={serverName(row.server)} onSave={value => renameConnection(slot, value)} />
      </SettingsBlock>
      {config && <SettingsBlock>
        <AgentNameSettings key={config.id} name={agentName.name} ready={agentName.ready} error={agentName.error}
          saving={agentName.saving} onSave={agentName.save} onRetry={agentName.reload} />
      </SettingsBlock>}
    </SettingsSection>
    <SettingsSection footer="Removing does not delete conversations on the server or stop running tasks.">
      <Pressable accessibilityRole="button" accessibilityLabel={`${row.status === 'pairing' ? 'Cancel pairing' : 'Remove connection'} ${row.name}`}
        onPress={remove} style={({ pressed }) => [styles.danger, pressed && styles.pressed]}>
        <Text style={styles.dangerText}>{row.status === 'pairing' ? 'Cancel pairing' : 'Remove connection'}</Text>
      </Pressable>
    </SettingsSection>
  </SettingsPage>;
}

/** Level 2: pair one more Hermes. */
export function AddConnectionSettings() {
  const router = useRouter();
  const { connections, addConnection } = useConnections();
  return <AddConnectionForm first={false} limitReached={connections.length >= MAX_CONNECTIONS}
    onAdd={async (server, code) => {
      const slot = await addConnection(server, code);
      // Show the new connection's own page, where pairing progress appears.
      router.replace(connectionSettingsRoute(slot));
    }} />;
}

/** Level 2: device font size. */
export function FontSizePage() {
  return <SettingsPage>
    <SettingsSection footer="Applies on this device to every connection: interface text and conversation reading.">
      <SettingsBlock first><FontSizeSettings /></SettingsBlock>
    </SettingsSection>
  </SettingsPage>;
}

/** Level 2: Home Screen icon of this device. */
export function AppIconPage() {
  return <SettingsPage>
    <SettingsSection footer="Changes the Hermes icon on this device's Home Screen. Your phone confirms the change with a short notice.">
      <SettingsBlock first><AppIconSettings /></SettingsBlock>
    </SettingsSection>
  </SettingsPage>;
}

const styles = StyleSheet.create({
  error: { color: '#9d1b32', backgroundColor: '#fff0f2', padding: 10, borderRadius: 8 },
  key: { fontSize: 13, color: '#607187' }, value: { fontSize: 16, color: '#172a40' }, issue: { color: '#8a5300' },
  hint: { fontSize: 13, lineHeight: 19, color: '#607187' },
  subhead: { fontSize: 16, fontWeight: '600', color: '#172a40' },
  danger: { minHeight: 50, borderRadius: 12, backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: '#d5dde8', alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: '#fff0f2' },
  dangerText: { fontSize: 16, color: '#b42335', fontWeight: '600' },
});
