import React from 'react';
import { Text } from 'react-native';
import { useFonts } from 'expo-font';

const font = { HermesWorkIcons: require('../../../assets/work-icons.ttf') };

/** Decorative only. Reserve space until the bundled font is ready; never use a text-font fallback. */
export function WorkChevron({ expanded }: { expanded: boolean }) {
  const [loaded] = useFonts(font);
  return <Text accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" allowFontScaling={false} style={{ fontFamily: 'HermesWorkIcons', fontSize: 16, lineHeight: 18, width: 18, height: 18, textAlign: 'center', color: '#65758b' }}>
    {loaded ? expanded ? '\ue001' : '\ue002' : ''}
  </Text>;
}
