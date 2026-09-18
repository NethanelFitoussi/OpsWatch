/**
 * SLO list row and the budget block of the SLO detail screen.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SloSummary } from '@/api/contract';
import { RichRow, StatusBadge } from '@/features/alerts/building-blocks';
import { useOpenRef } from '@/features/shared/navigation';
import { useI18n } from '@/i18n';
import { BudgetBar } from '@/ui/charts';
import { Text } from '@/ui/text';
import { spacing } from '@/ui/theme';
import { budgetText, burnRateExplanation, formatBurnRate, isBudgetExhausted, percentOrNull, sloStatusMeta } from './helpers';

export function useSloStatus() {
  const { t } = useI18n();
  return (status: SloSummary['status']) => {
    const meta = sloStatusMeta(status);
    return { ...meta, label: t(meta.label) };
  };
}

export const SloRow = memo(function SloRow({ slo }: { slo: SloSummary }) {
  const { t } = useI18n();
  const openRef = useOpenRef();
  const status = useSloStatus()(slo.status);
  const current = percentOrNull(slo.current) ?? t('metric.noData');
  const target = percentOrNull(slo.target) ?? t('metric.noData');
  const figures = t('slos.targetCurrent', { target, current });
  const budget = budgetText(slo.budgetRemaining);
  return (
    <RichRow
      testID={`slo-row-${slo.id}`}
      title={slo.name}
      meta={[slo.service?.label ?? slo.service?.id, figures].filter(Boolean).join(' · ')}
      left={<StatusBadge meta={status} />}
      extra={
        <View style={styles.budget}>
          <Text variant="caption" tone="muted">
            {t('slos.budgetRemaining')}
          </Text>
          <BudgetBar remaining={slo.budgetRemaining} />
        </View>
      }
      onPress={() => openRef({ type: 'slo', id: slo.id })}
      accessibilityLabel={[status.label, slo.name, slo.service?.label, figures, `${t('slos.budgetRemaining')}: ${t(budget.key, budget.params)}`].filter(Boolean).join(', ')}
    />
  );
});

/** Budget remaining (with "Budget exhausted" when it is gone) and the burn rate with its one-line meaning. */
export function BudgetBlock({ slo }: { slo: SloSummary }) {
  const { t } = useI18n();
  const exhausted = isBudgetExhausted(slo.budgetRemaining);
  const burn = formatBurnRate(slo.burnRate);
  const explanation = burnRateExplanation(slo.burnRate);
  return (
    <View style={styles.block}>
      {exhausted ? (
        <Text variant="subtitle" tone="critical" testID="slo-budget-exhausted">
          {t('slos.budgetExhausted')}
        </Text>
      ) : null}
      <BudgetBar remaining={slo.budgetRemaining} />
      <View style={styles.burn} accessible accessibilityLabel={`${t('slos.burnRate')}: ${burn ?? t('metric.noData')}. ${t(explanation.key, explanation.params)}`}>
        <Text variant="small" tone="muted">
          {t('slos.burnRate')}
        </Text>
        <Text variant="title" testID="slo-burn-rate">
          {burn ?? t('metric.noData')}
        </Text>
        <Text variant="small" tone="muted">
          {t(explanation.key, explanation.params)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  budget: { marginTop: spacing.xs, gap: 2 },
  block: { gap: spacing.md },
  burn: { gap: 2 },
});
