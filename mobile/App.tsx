import React, { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { TabBar, type Tab } from './src/components/TabBar';
import { ConfigProvider } from './src/context/ConfigContext';
import { DialogProvider } from './src/context/DialogContext';
import { LiveProvider, useLive } from './src/context/LiveContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ToastProvider } from './src/context/ToastContext';
import { ChecklistScreen } from './src/screens/ChecklistScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StatsScreen } from './src/screens/StatsScreen';
import { StudyPrepScreen } from './src/screens/StudyPrepScreen';
import { TimerScreen } from './src/screens/TimerScreen';

function Shell() {
  const [tab, setTab] = useState<Tab>('timer');
  const { colors, theme, toggle } = useTheme();
  const { connected, error } = useLive();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar
        barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
      />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={[styles.brandMark, { backgroundColor: colors.accent }]}>
              <Text style={[styles.brandMarkText, { color: colors.accentText }]}>
                W
              </Text>
            </View>
            <View>
              <Text style={[styles.brandTitle, { color: colors.text }]}>
                MobileStudy
              </Text>
              <Text style={[styles.brandSubtitle, { color: colors.textMuted }]}>
                carry-over study tracker
              </Text>
            </View>
          </View>

          <View style={styles.headerActions}>
            <View
              style={[
                styles.connection,
                {
                  backgroundColor: connected
                    ? colors.goodSoft
                    : colors.dangerSoft,
                },
              ]}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: connected ? colors.good : colors.danger },
                ]}
              />
              <Text
                style={[
                  styles.connectionText,
                  { color: connected ? colors.good : colors.danger },
                ]}>
                {connected ? 'Live' : 'Offline'}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={
                theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
              }
              hitSlop={8}
              onPress={toggle}
              style={({ pressed }) => [
                styles.themeButton,
                { backgroundColor: colors.cardAlt },
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.themeGlyph, { color: colors.textMuted }]}>
                {theme === 'dark' ? '☀' : '☾'}
              </Text>
            </Pressable>
          </View>
        </View>

        {!connected && error !== null ? (
          <View
            style={[
              styles.offlineBanner,
              {
                backgroundColor: colors.warnSoft,
                borderColor: colors.warnBorder,
              },
            ]}>
            <Text style={[styles.offlineText, { color: colors.warn }]}>
              ! {error}
            </Text>
          </View>
        ) : null}

        <View style={styles.content}>
          {tab === 'timer' ? <TimerScreen /> : null}
          {tab === 'checklist' ? <ChecklistScreen /> : null}
          {tab === 'prep' ? (
            <StudyPrepScreen onOpenChecklist={() => setTab('checklist')} />
          ) : null}
          {tab === 'stats' ? <StatsScreen /> : null}
          {tab === 'settings' ? <SettingsScreen /> : null}
        </View>
      </SafeAreaView>
      <TabBar active={tab} onChange={setTab} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ToastProvider>
          <DialogProvider>
            <ConfigProvider>
              <LiveProvider>
                <Shell />
              </LiveProvider>
            </ConfigProvider>
          </DialogProvider>
        </ToastProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMarkText: { fontSize: 17, fontWeight: '900' },
  brandTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  brandSubtitle: { fontSize: 10, fontWeight: '500' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  connectionText: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  themeButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeGlyph: { fontSize: 17, lineHeight: 20 },
  pressed: { opacity: 0.6 },
  offlineBanner: {
    marginHorizontal: 16,
    marginBottom: 4,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  offlineText: { fontSize: 11, lineHeight: 15 },
  content: { flex: 1 },
});
