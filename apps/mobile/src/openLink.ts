import { Alert, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

/** Web addresses open in the in-app browser (SFSafariViewController / Custom Tabs); other schemes use the system. */
export function openLink(href: string) {
  if (/^https?:\/\//i.test(href)) {
    void WebBrowser.openBrowserAsync(href, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET })
      .catch(() => Linking.openURL(href)).catch(() => Alert.alert('Could not open link'));
  } else void Linking.openURL(href).catch(() => Alert.alert('Could not open link'));
}
