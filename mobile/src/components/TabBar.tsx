import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  MaterialDesignIcons,
  type MaterialDesignIconsIconName,
} from '@react-native-vector-icons/material-design-icons/static';
import { useTheme } from '../context/ThemeContext';

export type Tab = 'timer' | 'checklist' | 'prep' | 'stats' | 'settings';

const TABS = [
  {
    id: 'timer',
    label: 'Timer',
    sfSymbol: 'timer',
    materialIcon: 'timer-outline',
  },
  {
    id: 'checklist',
    label: 'Checklist',
    sfSymbol: 'checklist',
    materialIcon: 'format-list-checks',
  },
  {
    id: 'prep',
    label: 'Prep',
    sfSymbol: 'sparkles',
    materialIcon: 'school-outline',
  },
  {
    id: 'stats',
    label: 'Stats',
    sfSymbol: 'chart.bar',
    materialIcon: 'chart-bar',
  },
  {
    id: 'settings',
    label: 'Settings',
    sfSymbol: 'gearshape',
    materialIcon: 'cog-outline',
  },
] satisfies ReadonlyArray<{
  id: Tab;
  label: string;
  sfSymbol: string;
  materialIcon: MaterialDesignIconsIconName;
}>;

const SFSymbol =
  Platform.OS === 'ios'
    ? (require('react-native-sfsymbols') as typeof import('react-native-sfsymbols'))
        .SFSymbol
    : null;

export function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: colors.tab,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, 6),
        },
      ]}>
      {TABS.map(tab => {
        const selected = active === tab.id;
        return (
          <Pressable
            accessibilityLabel={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={styles.tab}>
            <Pressable
              accessible={false}
              onPress={() => onChange(tab.id)}
              style={({ pressed }) => [
                styles.iconWrap,
                {
                  backgroundColor: selected
                    ? colors.accentSoft
                    : pressed
                      ? colors.cardAlt
                      : 'transparent',
                },
              ]}>
              {SFSymbol ? (
                <SFSymbol
                  color={selected ? colors.accent : colors.textFaint}
                  name={tab.sfSymbol}
                  size={20}
                  weight="medium"
                  style={styles.icon}
                />
              ) : (
                <MaterialDesignIcons
                  color={selected ? colors.accent : colors.textFaint}
                  name={tab.materialIcon}
                  size={20}
                />
              )}
            </Pressable>
            <Text
              style={[
                styles.label,
                { color: selected ? colors.accent : colors.textFaint },
              ]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
    paddingHorizontal: 6,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 3 },
  iconWrap: {
    width: 42,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { width: 24, height: 24 },
  label: {
    minHeight: 12,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
});
