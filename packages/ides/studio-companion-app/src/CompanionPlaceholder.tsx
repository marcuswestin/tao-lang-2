import { StyleSheet, Text, View } from 'react-native'

/** CompanionPlaceholder tells a person that the shell is opened from Tao Studio, and how. */
export function CompanionPlaceholder() {
  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Tao Companion</Text>
        <Text style={styles.body}>
          This app is opened from Tao Studio on your Mac; it does not run a project on its own.
        </Text>
        <Text style={styles.body}>
          {'Run `just studio <project>` on the Mac, then press Open on device or scan the QR code Studio shows.'}
        </Text>
        <Text style={styles.note}>
          The device and the Mac must share a network. Allow local-network access when iOS asks: that is how the app
          reaches Studio.
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: {
    color: '#d7dbe7',
    fontSize: 16,
    lineHeight: 22,
    marginBottom: 12,
  },
  card: {
    maxWidth: 480,
    width: '100%',
  },
  note: {
    color: '#8e95a8',
    fontSize: 14,
    lineHeight: 20,
  },
  screen: {
    alignItems: 'center',
    backgroundColor: '#171b2d',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingVertical: 80,
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 16,
  },
})
