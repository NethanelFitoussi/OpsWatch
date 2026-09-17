# OpsWatch

**Supervision open source et auto-hébergée de vos conteneurs, bases de données et journaux AWS.**

[English](README.md) · [Licence : MIT](LICENSE)

OpsWatch tourne sur votre propre infrastructure et lit vos comptes AWS en lecture seule.
Rien ne quitte votre réseau : pas de SaaS, aucun agent à installer dans vos applications.

![Guide de démarrage](docs/screenshots/getting-started-light.png)

## État du projet

OpsWatch est construit par étapes. Cette version couvre les fondations :

| Étape | Contenu | État |
|-------|---------|------|
| 1 | Compte administrateur, connexions AWS, test des permissions, guide de démarrage (anglais et français) | Disponible |
| 2 | Conteneurs : clusters, services et tâches ECS, load balancers | Prévu |
| 3 | Bases de données : métriques RDS et Aurora, Performance Insights | Prévu |
| 4 | Journaux : recherche CloudWatch Logs et Logs Insights | Prévu |
| 5 | Analyses automatiques et sauvegardes à la demande depuis le tableau de bord | Prévu |

## Démarrage rapide

Prérequis : Docker avec Compose v2.

```bash
git clone https://github.com/<owner>/opswatch.git
cd opswatch
cp .env.example .env
# Mettez au moins 32 caractères aléatoires dans OPSWATCH_SECRET :
sed -i "s|^OPSWATCH_SECRET=.*|OPSWATCH_SECRET=$(openssl rand -base64 48 | tr -d '\n')|" .env
docker compose up -d --build
```

Ouvrez http://localhost:3000. La première visite vous demande de créer le compte
administrateur, puis le guide de démarrage vous accompagne pour connecter un compte AWS.

`docker-compose.yml` ne publie le port que sur `127.0.0.1` : tant que le compte administrateur
n'existe pas, la première personne qui ouvre OpsWatch peut le créer. Pour accéder à OpsWatch
depuis d'autres machines, terminez d'abord la création de l'administrateur, puis placez-le
derrière un reverse proxy en HTTPS, définissez `OPSWATCH_PUBLIC_URL` avec son adresse publique
et faites pointer le proxy vers `127.0.0.1:3000`.

OpsWatch refuse de démarrer si `OPSWATCH_SECRET` est absent ou fait moins de 32 caractères.
Conservez cette valeur : elle chiffre les clés d'accès enregistrées et signe les sessions.
La changer déconnecte tout le monde et rend les clés enregistrées illisibles.

## Connecter AWS

![Connexion et sa liste de permissions](docs/screenshots/connection.png)

OpsWatch propose trois méthodes. Le guide intégré à l'application détaille chacune étape par étape.

1. **Rôle IAM (recommandé).** OpsWatch génère un modèle CloudFormation qui crée un rôle en
   lecture seule nommé `OpsWatchReadOnly-<id>` dans le compte supervisé. Le rôle ne fait
   confiance qu'à l'identité AWS d'OpsWatch, et seulement si elle présente un ExternalId
   aléatoire propre à la connexion. OpsWatch assume le rôle et reçoit des identifiants
   temporaires valables une heure.
2. **Identifiants ambiants.** OpsWatch utilise l'identité avec laquelle il tourne déjà : rôle
   de tâche ECS, profil d'instance EC2, ou profil d'un répertoire `~/.aws` monté.
3. **Clés d'accès.** La paire de clés d'un utilisateur IAM, chiffrée au repos. À n'utiliser
   que si les deux autres méthodes sont impossibles.

Une fois connecté, **Lancer le test** appelle une action en lecture par service et par
région, et montre ce qu'OpsWatch peut voir ou non.

## Modèle de sécurité

- Tous les appels AWS s'exécutent côté serveur. Les identifiants n'atteignent jamais le navigateur.
- Le rôle généré n'autorise que des actions de lecture : la liste complète figure dans le
  guide et dans `src/lib/aws/actions.ts`. L'identité d'OpsWatch n'a besoin que de
  `sts:AssumeRole` sur `arn:aws:iam::*:role/OpsWatchReadOnly-*`.
- L'ExternalId empêche une autre instance d'OpsWatch, ou toute personne connaissant l'ARN du
  rôle, de l'assumer.
- Les clés d'accès sont chiffrées en AES-256-GCM avec une clé dérivée de `OPSWATCH_SECRET`.
- Un unique compte administrateur protège l'instance. Les mots de passe sont hachés avec
  argon2id, les sessions expirent après 12 heures d'inactivité, et les tentatives de connexion
  sont limitées à 5 par minute par client.
- L'adresse d'un client peut être falsifiée, donc les connexions sont aussi surveillées
  globalement. Dès que plus de 20 connexions ont échoué dans la dernière minute, OpsWatch
  vérifie les mots de passe un par un, à au moins 3 secondes d'intervalle, et refuse les
  nouvelles tentatives tant que plus de 50 sont déjà en attente. L'administrateur n'est jamais
  bloqué : le bon mot de passe fonctionne toujours pendant une attaque, après une attente.
- Placez OpsWatch derrière HTTPS et définissez `OPSWATCH_PUBLIC_URL` pour que les cookies
  soient marqués `Secure`.

Signalez les vulnérabilités en privé comme indiqué dans [SECURITY.md](SECURITY.md).

## Configuration

| Variable | Obligatoire | Rôle |
|----------|-------------|------|
| `OPSWATCH_SECRET` | Oui, 32 caractères minimum | Chiffre les clés d'accès et signe les sessions |
| `OPSWATCH_DATA_DIR` | Non, `/data` par défaut | Emplacement de la base SQLite |
| `OPSWATCH_PUBLIC_URL` | Non | URL publique ; active les cookies `Secure` en HTTPS |
| `OPSWATCH_TEMPLATE_BUCKET` | Non | Bucket S3 qui active le bouton « Launch Stack » |
| `AWS_*`, `AWS_PROFILE` | Pour les méthodes rôle et ambiante | Identité AWS propre à OpsWatch |
| `OPSWATCH_AWS_ENDPOINT_URL` | Tests uniquement | Envoie tous les appels AWS vers un serveur moto |

## Développement

Voir [CONTRIBUTING.md](CONTRIBUTING.md) (en anglais).

## Licence

[MIT](LICENSE)
