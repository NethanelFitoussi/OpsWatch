/**
 * Demo mode only: switch off what the demo server claims to offer, and watch the app degrade exactly as it would
 * against a real OpsWatch server that lacks those capabilities.
 *
 * This exists because "degrades honestly" is a promise the app makes to every self-hosted installation, and a
 * contributor should be able to check it without an AWS account, a second server, or any configuration.
 */
import { FEATURES, type Feature } from '@/api/contract';
import { useI18n } from '@/i18n';
import { useSession } from '@/state/session';
import { useSettings } from '@/state/settings';
import { Button } from '@/ui/controls';
import { Card, Divider, Section } from '@/ui/layout';
import { View } from 'react-native';
import { Note, SwitchRow } from './components';

/** The capabilities worth switching by hand: each one visibly changes what the app shows. */
export const DEMO_TOGGLES: Feature[] = ['ai', 'logs', 'incidents', 'synthetics', 'slos', 'deployments', 'repository', 'search', 'favorites', 'environments', 'brief'];

export function DemoCapabilitiesSection() {
  const { t } = useI18n();
  const { state } = useSession();
  const { settings, update } = useSettings();
  if (state.status !== 'signed-in' || !state.server.demo) return null;

  const overrides = settings.demoCapabilities;
  const changed = FEATURES.some((feature) => overrides[feature] === false);
  const setFeature = (feature: Feature, enabled: boolean) =>
    update((current) => ({ demoCapabilities: { ...current.demoCapabilities, [feature]: enabled } }));

  return (
    <Section title={t('demo.capabilities')} action={changed ? <Button label={t('demo.reset')} variant="ghost" compact onPress={() => update({ demoCapabilities: {} })} testID="demo-reset" /> : undefined}>
      <Note testID="demo-capabilities-note">{t('demo.capabilitiesHint')}</Note>
      <Card padded={false}>
        {DEMO_TOGGLES.map((feature, i) => (
          <View key={feature}>
            {i > 0 ? <Divider /> : null}
            <SwitchRow
              label={t(`demo.feature.${feature}` as Parameters<typeof t>[0])}
              value={overrides[feature] !== false}
              onChange={(enabled) => setFeature(feature, enabled)}
              testID={`demo-capability-${feature}`}
            />
          </View>
        ))}
      </Card>
    </Section>
  );
}
