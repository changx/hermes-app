import React from 'react'
import {Text,View} from 'react-native'
import {HermesClient} from '../../../packages/client/src/index'
import {mobileTransport} from './transport'
// Native view export proof only. No token or network connection is bundled.
const hasClient = typeof HermesClient === 'function' && typeof mobileTransport === 'function'
export default function App() { return <View><Text>Hermes P1 shared client Android JS: {String(hasClient)}</Text></View> }
