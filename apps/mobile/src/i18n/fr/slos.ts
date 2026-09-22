import type { slos as source } from '../en/slos';

export const slos: Record<keyof typeof source, string> = {
  'slos.status.healthy': 'Sain',
  'slos.status.at_risk': 'À risque',
  'slos.status.breached': 'Non respecté',
  'slos.status.unknown': 'Inconnu',
  'slos.empty': 'Aucun SLO',
  'slos.emptyBody': 'Aucun objectif de niveau de service n’est défini pour cet environnement.',
  'slos.targetCurrent': 'objectif {target} · actuel {current}',
  'slos.target': 'Objectif',
  'slos.current': 'Actuel',
  'slos.window': 'Période',
  'slos.budgetRemaining': 'Budget d’erreur restant',
  'slos.budgetLeft': '{value} du budget d’erreur restant',
  'slos.budgetExhausted': 'Budget épuisé',
  'slos.burnRate': 'Taux de consommation',
  'slos.burnRateFast': '×{rate} signifie que le budget durerait 1/{rate} de la période.',
  'slos.burnRateSlow': '×{rate} signifie que le budget n’est pas consommé plus vite que prévu : il tient toute la période.',
  'slos.burnRateNoData': 'Pas encore de taux de consommation : données insuffisantes.',
  'slos.performance': 'Performance',
  'slos.budgetChart': 'Budget d’erreur dans le temps',
  'slos.noSeries': 'Pas encore de données pour ce SLO.',
};
