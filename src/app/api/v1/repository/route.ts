import { repositoryStateSchema } from '@opswatch/contract';
import { apiJson } from '@/lib/api/v1/envelope';
import { apiRoute } from '@/lib/api/v1/handler';
import { readGithubConnection } from '@/lib/github/connection';
import { listRepositories } from '@/lib/store/repositories';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/v1/repository`.
 *
 * What a client needs before it offers a "see the code" affordance: whether a connection exists, whether it
 * has been **verified**, and which repositories are recorded. Not scoped to an environment, because a
 * repository belongs to the instance rather than to one AWS account and region.
 *
 * The token is not in this answer and there is no field for it.
 */
export const GET = apiRoute({
  handler: async ({ db }) => {
    const connection = readGithubConnection(db);
    const state =
      connection === null
        ? 'not_connected'
        : connection.status === 'configured'
          ? 'connected'
          : connection.status === 'failed'
            ? 'failed'
            : 'unverified';

    return apiJson(repositoryStateSchema, {
      state,
      ...(connection?.account == null ? {} : { account: connection.account }),
      repositories: listRepositories(db).map((repository) => ({
        id: repository.id,
        fullName: `${repository.owner}/${repository.name}`,
        defaultBranch: repository.defaultBranch,
      })),
    });
  },
});
