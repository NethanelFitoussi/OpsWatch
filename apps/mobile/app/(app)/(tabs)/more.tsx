import { useRouter, type Href } from 'expo-router';
import { View } from 'react-native';
import type { Feature } from '@/api/contract';
import { useI18n, type MessageKey } from '@/i18n';
import { useSession } from '@/state/session';
import { Card, Divider, Row, Section, type IconName } from '@/ui/layout';
import { ScrollScreen } from '@/ui/screen';

type Entry = { href: string; label: MessageKey; icon: IconName; feature?: Feature };

const INVESTIGATE: Entry[] = [
  { href: '/errors', label: 'nav.errors', icon: 'bug-outline', feature: 'errors' },
  { href: '/logs', label: 'nav.logs', icon: 'document-text-outline', feature: 'logs' },
  { href: '/infrastructure', label: 'nav.infrastructure', icon: 'server-outline', feature: 'infrastructure' },
  { href: '/deployments', label: 'nav.deployments', icon: 'rocket-outline', feature: 'deployments' },
  { href: '/ask', label: 'nav.ask', icon: 'sparkles-outline', feature: 'ai' },
  { href: '/search', label: 'nav.search', icon: 'search-outline' },
];
const OPERATE: Entry[] = [
  { href: '/incidents', label: 'nav.incidents', icon: 'flame-outline', feature: 'incidents' },
  { href: '/synthetics', label: 'nav.synthetics', icon: 'globe-outline', feature: 'synthetics' },
  { href: '/slos', label: 'nav.slos', icon: 'speedometer-outline', feature: 'slos' },
  { href: '/brief', label: 'nav.brief', icon: 'sunny-outline', feature: 'brief' },
];
const ACCOUNT: Entry[] = [{ href: '/settings', label: 'nav.settings', icon: 'settings-outline' }];

/**
 * Every secondary destination. Entries for capabilities the server lacks stay visible (so people know they exist)
 * and open an explanatory "not available on this server" state rather than disappearing.
 */
export default function MoreScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { state } = useSession();
  const features = state.status === 'signed-in' ? state.server.info?.features : undefined;

  const group = (title: MessageKey, entries: Entry[]) => (
    <Section title={t(title)}>
      <Card padded={false}>
        {entries.map((entry, i) => (
          <View key={entry.href}>
            {i > 0 ? <Divider /> : null}
            <Row
              title={t(entry.label)}
              subtitle={entry.feature && features && !features[entry.feature] ? t('state.featureUnavailableTitle') : undefined}
              icon={entry.icon}
              onPress={() => router.push(entry.href as Href)}
              testID={`more-${entry.href.slice(1)}`}
            />
          </View>
        ))}
      </Card>
    </Section>
  );

  return (
    <ScrollScreen testID="more-screen">
      {group('more.investigate', INVESTIGATE)}
      {group('more.operate', OPERATE)}
      {group('more.account', ACCOUNT)}
    </ScrollScreen>
  );
}
