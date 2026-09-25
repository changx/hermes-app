import React from 'react'
import { Text, View } from 'react-native'
import { JsonRpcRequestChannel } from '@hermes-sdk/json-rpc-channel'
import { JsonRpcGatewayClient } from '@hermes-sdk/json-rpc-gateway'

// Diagnostic native-view entry: no network, credentials, webview or product UI.
const channel = new JsonRpcRequestChannel({ heartbeatIntervalMs: 0 })
const gateway = new JsonRpcGatewayClient({ heartbeatIntervalMs: 0 })
export default function App() {
  return <View><Text>Hermes P0 Android native JS export; SDK connected: {String(channel.connected || gateway.connectionState === 'open')}</Text></View>
}
