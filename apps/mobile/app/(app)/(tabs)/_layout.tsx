import { Ionicons } from '@expo/vector-icons';
import Tabs from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useHealth } from '@/api/queries';
import { HeaderActions } from '@/features/shared/header';
import { useI18n } from '@/i18n';
import { useTheme } from '@/ui/theme-provider';

type IconName = ComponentProps<typeof Ionicons>['name'];

function tabIcon(name: IconName, focusedName: IconName) {
  return function TabIcon({ color, focused, size }: { color: ColorValue; focused: boolean; size: number }) {
    return <Ionicons name={focused ? focusedName : name} size={size} color={color as string} />;
  };
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const health = useHealth();
  const critical = health.data?.counts.critical ?? 0;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.text },
        headerRight: () => <HeaderActions />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tab.home'), tabBarIcon: tabIcon('pulse-outline', 'pulse'), tabBarButtonTestID: 'tab-home' }} />
      <Tabs.Screen
        name="problems"
        options={{
          title: t('tab.problems'),
          tabBarIcon: tabIcon('alert-circle-outline', 'alert-circle'),
          tabBarBadge: critical > 0 ? critical : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.critical, color: colors.onPrimary },
          tabBarAccessibilityLabel: critical > 0 ? `${t('tab.problems')}, ${critical} ${t('home.count.critical')}` : t('tab.problems'),
          tabBarButtonTestID: 'tab-problems',
        }}
      />
      <Tabs.Screen name="alerts" options={{ title: t('tab.alerts'), tabBarIcon: tabIcon('notifications-outline', 'notifications'), tabBarButtonTestID: 'tab-alerts' }} />
      <Tabs.Screen name="services" options={{ title: t('tab.services'), tabBarIcon: tabIcon('apps-outline', 'apps'), tabBarButtonTestID: 'tab-services' }} />
      <Tabs.Screen name="more" options={{ title: t('tab.more'), tabBarIcon: tabIcon('menu-outline', 'menu'), tabBarButtonTestID: 'tab-more' }} />
    </Tabs>
  );
}
