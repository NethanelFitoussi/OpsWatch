import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useHealth } from '@/api/queries';
import { ChangesList, CountsRow, CoverageList, MostImportantProblem, StatusHero, SyntheticsStrip } from '@/features/home/components';
import { useCurrentEnvironment } from '@/features/shared/header';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';
import { useFeature } from '@/state/session';
import { SeverityBadge } from '@/ui/badges';
import { Button } from '@/ui/controls';
import { Card, Divider, Row, Section } from '@/ui/layout';
import { QueryScreen } from '@/ui/screen';
import { FeatureGate } from '@/ui/states';

export default function HomeScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const openRef = useOpenRef();
  const health = useHealth();
  const environment = useCurrentEnvironment();
  const hasBrief = useFeature('brief');

  return (
    <FeatureGate feature="health" label={t('tab.home')}>
      <QueryScreen query={health} testID="home-screen">
        {(data) => (
          <>
            <StatusHero health={data} environment={environment} />
            <CountsRow counts={data.counts} />
            <MostImportantProblem problem={data.topProblem} title={t('home.mostImportant')} />

            <Section title={t('home.sinceYesterday')} action={hasBrief ? <Button label={t('action.seeAll')} variant="ghost" compact onPress={() => router.push('/brief')} testID="open-brief" /> : undefined}>
              <ChangesList changes={data.changes} emptyLabel={t('brief.noChanges')} />
            </Section>

            {data.activeAlerts !== null ? (
              <Card padded={false}>
                <Row title={t('home.activeAlerts')} subtitle={t('home.activeAlertsCount', { count: data.activeAlerts })} icon="notifications-outline" onPress={() => router.push('/alerts')} testID="active-alerts" />
              </Card>
            ) : null}

            {data.synthetics ? <SyntheticsStrip synthetics={data.synthetics} /> : null}

            {data.recentIncidents.length ? (
              <Section title={t('home.incidents')}>
                <Card padded={false}>
                  {data.recentIncidents.map((incident, i) => (
                    <View key={incident.id}>
                      {i > 0 ? <Divider /> : null}
                      <Row
                        title={incident.title}
                        subtitle={`${t(`incidents.status.${incident.status}`)} · ${formatDateTime(incident.startedAt, locale)}`}
                        left={<SeverityBadge severity={incident.severity} />}
                        onPress={() => openRef({ type: 'incident', id: incident.id })}
                      />
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            {data.recentDeployments.length ? (
              <Section title={t('home.deployments')}>
                <Card padded={false}>
                  {data.recentDeployments.map((deployment, i) => (
                    <View key={deployment.id}>
                      {i > 0 ? <Divider /> : null}
                      <Row
                        title={`${deployment.service.label ?? deployment.service.id} ${deployment.version}`}
                        subtitle={formatDateTime(deployment.at, locale)}
                        icon="rocket-outline"
                        onPress={() => openRef({ type: 'deployment', id: deployment.id })}
                      />
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}

            {data.families.length ? (
              <Section title={t('home.coverage')}>
                <CoverageList families={data.families} />
              </Section>
            ) : null}
          </>
        )}
      </QueryScreen>
    </FeatureGate>
  );
}
