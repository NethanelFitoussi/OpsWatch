import type { checkup as source } from '../en/checkup';

export const checkup: Record<keyof typeof source, string> = {
  'nav.checkup': 'Diagnostic',
  'checkup.subtitle': 'Ce qui ne va pas dans la configuration de cet environnement.',
  'checkup.difference':
    'Un constat porte sur la configuration et reste tant que personne ne change un réglage. Un problème est quelque chose qui casse maintenant, et disparaît quand cela s’arrête.',

  'checkup.coverage': '{ran} vérifications sur {total} ont été faites',
  'checkup.coverage.all': 'Les {total} vérifications ont été faites',
  'checkup.coverage.notRun': '{notRun} n’ont pas pu être faites',
  'checkup.findings': 'Constats',
  'checkup.notRun': 'Vérifications impossibles',
  'checkup.empty.title': 'Rien à signaler',
  'checkup.empty.body': 'Aucune des vérifications effectuées n’a trouvé de problème de configuration dans cet environnement.',
  'checkup.empty.partial':
    'Les vérifications effectuées n’ont rien trouvé. Celles ci-dessous n’ont pas pu être faites : ce n’est donc pas un satisfecit complet.',

  'checkup.reason.denied': 'La permission nécessaire a été refusée : la réponse est inconnaissable d’ici.',
  'checkup.reason.not_collected': 'OpsWatch ne collecte pas encore les données que lit cette vérification.',
  'checkup.reason.cap': 'La portée a été réduite pour rester dans le budget de requêtes.',
  'checkup.reason.unsupported': 'Cette ressource ne peut pas répondre à la question.',

  'checkup.check.permissions_untested': 'Cette connexion n’a jamais été testée',
  'checkup.check.permissions_denied': 'AWS a refusé {count} permission(s) : {services}',
  'checkup.check.permissions_errored': 'AWS a renvoyé une erreur pour {count} permission(s) : {services}',
  'checkup.check.account_mismatch': 'Les identifiants atteignent un compte AWS différent de celui configuré',
  'checkup.check.family_unreadable': '{family} n’a pas pu être lu ({reason})',
  'checkup.check.errors_not_collected': 'Aucun groupe de journaux n’est activé : aucune erreur n’est collectée',
  'checkup.check.history_off': 'La collecte historique est désactivée : ni références, ni SLO, ni rapports de long terme',
  'checkup.check.logs_budget': 'Budget d’analyse des journaux',
  'checkup.check.logs_budget_exhausted': 'Le budget d’analyse des journaux du jour est épuisé ({scanned} Go sur {limit})',
  'checkup.check.collector_never_ran': 'Le collecteur n’a jamais tourné : rien n’a été mesuré',
  'checkup.check.collector_job_failing': '{count} tâche(s) de collecte en échec : {jobs}',
  'checkup.check.template_outdated': 'La stack CloudFormation est en version {version} ; la version actuelle est {current}',
  'checkup.check.unknown': 'Une vérification que cette application ne connaît pas ({id})',

  'checkup.name.permissions_untested': 'Test de la connexion',
  'checkup.name.permissions_denied': 'Permissions AWS',
  'checkup.name.permissions_errored': 'Permissions AWS',
  'checkup.name.account_mismatch': 'Correspondance du compte AWS',
  'checkup.name.family_unreadable': 'Lisibilité des ressources',
  'checkup.name.errors_not_collected': 'Collecte des erreurs',
  'checkup.name.history_off': 'Collecte historique',
  'checkup.name.logs_budget': 'Budget d’analyse des journaux',
  'checkup.name.logs_budget_exhausted': 'Budget d’analyse des journaux',
  'checkup.name.collector_never_ran': 'Collecteur',
  'checkup.name.collector_job_failing': 'Tâches de collecte',
  'checkup.name.template_outdated': 'Version de la stack CloudFormation',
  'checkup.name.unknown': 'Une vérification que cette application ne connaît pas ({id})',
};
