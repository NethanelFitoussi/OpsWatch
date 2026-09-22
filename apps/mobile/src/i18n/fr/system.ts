import type { system as source } from '../en/system';

export const system: Record<keyof typeof source, string> = {
  'nav.system': 'État du système',
  'system.subtitle': 'Si OpsWatch lui-même fonctionne, et ce que cela implique pour tout le reste ici.',

  'system.verdict.never': 'OpsWatch n’a encore rien collecté',
  'system.verdict.stopped': 'OpsWatch a cessé de collecter',
  'system.verdict.stale': 'OpsWatch a peut-être cessé de collecter',
  'system.verdict.failing': 'Collecte en cours, avec des échecs',
  'system.verdict.collecting': 'OpsWatch collecte',

  'system.consequence.never': 'Les autres écrans sont vides parce que rien n’a encore été observé, pas parce que tout va bien.',
  'system.consequence.stopped': 'Les autres écrans montrent la dernière chose vue par OpsWatch, qui n’est pas maintenant.',
  'system.consequence.stale': 'Le collecteur se dit actif mais ne s’est pas manifesté depuis un moment. Considérez ce que vous voyez comme peut-être périmé.',
  'system.consequence.failing': 'Ce que couvrent les tâches en échec peut être périmé. Le reste est à jour.',
  'system.consequence.collecting': 'Ce que montrent les autres écrans est à jour.',

  'system.heartbeat': 'Dernier signe de vie',
  'system.heartbeat.never': 'Jamais',
  'system.owner': 'Exécuté sur',
  'system.jobs': 'Tâches de collecte',
  'system.jobs.none': 'Ce serveur ne signale aucune tâche de collecte.',
  'system.job.running': 'En cours',
  'system.job.ok': 'OK',
  'system.job.failed': 'Échec',
  'system.job.skipped': 'Ignorée',
  'system.job.never': 'Jamais exécutée',
  'system.job.every': 'toutes les {interval}',
  'system.job.lastRun': 'Dernière exécution {time}',
  'system.job.nextRun': 'prochaine {time}',
  'system.job.nextRunUnknown': 'prochaine exécution non planifiée',
  'system.job.took': 'durée {duration}',
  'system.job.partial': '{covered} sur {total} couverts',
  'system.job.truncated': 'Arrêtée à une limite : cette exécution est incomplète.',
  'system.job.errorCode': 'Erreur : {code}',

  'system.environments': 'Environnements lus',
  'system.environments.none': 'Aucun environnement n’a été lu.',
  'system.environment.read': '{read} types de ressources lus sur {total}',
  'system.environment.readAll': 'Tout a été lu',
  'system.environment.lastRead': 'Dernière lecture {time}',
  'system.environment.neverRead': 'Jamais lu',

  'system.about': 'Ce serveur OpsWatch',
  'system.version': 'Version',
  'system.database': 'Base de données',
  'system.schema': 'Version du schéma',

  'system.forbidden': 'Seul un administrateur peut voir l’état du système.',
  'system.forbiddenBody': 'Votre compte utilise OpsWatch normalement ; cette page rend compte du serveur lui-même.',
};
