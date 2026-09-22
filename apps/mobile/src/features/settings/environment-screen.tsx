/**
 * Environment picker. Production is marked loudly, and switching TO production needs a second, explicit tap after a
 * warning, so nobody confuses production with staging.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { Environment } from '@/api/contract';
import { useEnvironments } from '@/api/queries';
import { useI18n, type MessageKey } from '@/i18n';
import { useFeature } from '@/state/session';
import { useSettings } from '@/state/settings';
import { EnvironmentBadge } from '@/ui/badges';
import { Button } from '@/ui/controls';
import { Card, Divider, Row } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { EmptyState } from '@/ui/states';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/theme-provider';
import { Note } from './components';
import { chooseEnvironment, effectiveEnvironmentId } from './helpers';

function ProductionWarning({ environment, onConfirm, onCancel }: { environment: Environment; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.productionBg, padding: spacing.lg, gap: spacing.sm }} accessibilityLiveRegion="assertive" testID="env-production-warning">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Ionicons name="flame" size={18} color={colors.production} importantForAccessibility="no" />
        <Text weight="700" style={{ color: colors.production, flex: 1 }}>
          {t('env.productionWarning')}
        </Text>
      </View>
      <Text variant="small" style={{ color: colors.production }}>
        {t('settings.environmentProductionBody')}
      </Text>
      <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
        <Button label={t('action.cancel')} variant="secondary" compact onPress={onCancel} testID="env-confirm-cancel" />
        <Button label={t('settings.environmentSwitchTo', { name: environment.name })} variant="danger" icon="flame" compact onPress={onConfirm} testID="env-confirm" />
      </View>
    </View>
  );
}

export function EnvironmentScreen() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const router = useRouter();
  const query = useEnvironments();
  const enabled = useFeature('environments');
  const { settings, update } = useSettings();
  const [pending, setPending] = useState<string | null>(null);

  if (!enabled) return <EmptyState icon="layers-outline" title={t('settings.environment')} body={t('settings.environmentSingle')} />;

  const select = (environment: Environment) => {
    update({ environmentId: environment.id });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <QueryScreen query={query} testID="environment-screen">
      {(list) => {
        const currentId = effectiveEnvironmentId(list, settings.environmentId);
        if (list.length <= 1) return <Note>{t('settings.environmentSingle')}</Note>;
        return (
          <>
            <Note>{t('settings.environmentHint')}</Note>
            <Card padded={false}>
              {list.map((environment, i) => {
                const current = environment.id === currentId;
                const production = environment.kind === 'production';
                const onPress = () => {
                  const choice = chooseEnvironment(environment, currentId, pending);
                  if (choice.action === 'confirm') setPending(environment.id);
                  else if (choice.action === 'select') select(environment);
                };
                return (
                  <View key={environment.id}>
                    {i > 0 ? <Divider /> : null}
                    <Row
                      title={environment.name}
                      subtitle={[t(`env.${environment.kind}` as MessageKey), environment.description, current ? t('settings.environmentCurrent') : null].filter(Boolean).join(' · ')}
                      left={<EnvironmentBadge environment={environment} />}
                      right={current ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} accessibilityLabel={t('settings.environmentCurrent')} /> : undefined}
                      onPress={onPress}
                      chevron={false}
                      accessibilityLabel={[production ? t('env.production').toUpperCase() : null, environment.name, environment.description, current ? t('settings.environmentCurrent') : null].filter(Boolean).join(', ')}
                      testID={`env-row-${environment.id}`}
                    />
                    {pending === environment.id && !current ? <ProductionWarning environment={environment} onConfirm={() => select(environment)} onCancel={() => setPending(null)} /> : null}
                  </View>
                );
              })}
            </Card>
          </>
        );
      }}
    </QueryScreen>
  );
}
