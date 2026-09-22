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
import { FeatureGate, useNow, useRelativeTime } from '@/ui/states';

/**
 * The first screenful answers the three questions on its own: is production healthy (hero), do I need to act
 * (verdict and counts), what is the worst thing right now (the top problem, with its Investigate button). Everything
 * below is context.
 */
export default function HomeScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const openRef = useOpenRef();
  const health = useHealth();
  const environment = useCurrentEnvironment();
  const hasBrief = useFeature('brief');
  const now = useNow();
  const relative = useRelativeTime();

  return (
    <FeatureGate feature="health" label={t('tab.home')}>
      <QueryScreen query={health} testID="home-screen">
        {(data) => (
          <>
            <StatusHero health={data} environment={environment} />
            {/* The worst thing comes before the tally: on a 375x667 phone both must be readable without scrolling. */}
            <MostImportantProblem problem={data.topProblem} title={t('home.mostImportant')} />
            <CountsRow counts={data.counts} />

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
                        subtitle={`${t(`incidents.status.${incident.status}`)} · ${relative(incident.startedAt, now)} · ${formatDateTime(incident.startedAt, locale)}`}
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
                      {/* How long ago comes first: "was a deployment nearby?" is the question this list answers. */}
                      <Row
                        title={`${deployment.service.label ?? deployment.service.id} ${deployment.version}`}
                        subtitle={`${relative(deployment.at, now)} · ${formatDateTime(deployment.at, locale)}`}
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
