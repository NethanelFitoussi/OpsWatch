import { describe, expect, it } from 'vitest';
import { createGoogleConnection, createConnection } from '@/lib/connections/repository';
import { ACROSS_LIMIT, readProblemsAcross } from '@/lib/read/across';
import { insertProblem, updateProblem } from '@/lib/store/problems';
import { createTestDb } from '../helpers/db';
import { connectionInput } from '../helpers/fixtures';
import { FIXED_NOW, newProblem } from '../helpers/detect';

/**
 * What is wrong anywhere.
 *
 * The rail answers "what is wrong in this account and this region", which is right once you know
 * where to look. An operator with three AWS accounts and a Google project has to know where to look
 * before they can ask, so the answer depends on where they started. This is the other question.
 *
 * The thing it must not do while answering it is flatten the clouds together. "The payments database
 * is at 98 % CPU" and "Google has an open incident on checkout" are fixed in different places, and a
 * unified list that dropped which cloud produced it would be a list nobody could act on.
 */

const SECRET = 'instance-secret'.padEnd(32, 'x');
const context = { nowMs: FIXED_NOW, render: (key: string) => key };

const google = {
  name: 'analytics',
  projectId: 'my-project',
  projectNumber: '123456789012',
  poolId: 'opswatch',
  providerId: 'opswatch',
  serviceAccount: '',
  regions: ['us-central1'],
};

function twoClouds() {
  const db = createTestDb();
  const aws = createConnection(db, connectionInput({ name: 'production' }), new Date(FIXED_NOW));
  const gcp = createGoogleConnection(db, google, SECRET, new Date(FIXED_NOW));
  return { db, aws, gcp };
}

describe('problems across every connection', () => {
  it('THE RULING: every row says which cloud produced it', () => {
    const { db, aws, gcp } = twoClouds();
    insertProblem(db, newProblem({ key: 'a'.repeat(32), connectionId: aws.id, scope: 'us-east-1', source: 'aws' }));
    insertProblem(
      db,
      newProblem({ key: 'g'.repeat(32), connectionId: gcp.id, scope: 'my-project', source: 'gcp', kind: 'gcp_incident', score: 90 }),
    );

    const { problems } = readProblemsAcross(db, {}, context);
    expect(problems).toHaveLength(2);
    // The cloud, the connection and the scope: the three things that say where to go and act.
    expect(problems.map((problem) => [problem.provider, problem.connectionName, problem.scope])).toEqual([
      ['gcp', 'analytics', 'my-project'],
      ['aws', 'production', 'us-east-1'],
    ]);
  });

  it('puts the worst first, because a list read top-down should start with what matters', () => {
    const { db, aws } = twoClouds();
    insertProblem(db, newProblem({ key: 'l'.repeat(32), connectionId: aws.id, score: 10, severity: 'info' }));
    insertProblem(db, newProblem({ key: 'h'.repeat(32), connectionId: aws.id, score: 95, subjectId: 'prod/api' }));

    expect(readProblemsAcross(db, {}, context).problems.map((problem) => problem.severity)).toEqual(['critical', 'info']);
  });

  it('THE RULING: a Google problem gets no link into the AWS rail', () => {
    /*
     * `href` on a problem row is a monitoring-rail path, and the rail is ten AWS services. Following
     * one for a Google incident would open a page about a service that cloud does not have — which is
     * the "clone the AWS UI and change the names" failure, arriving through a link.
     */
    const { db, gcp, aws } = twoClouds();
    insertProblem(db, newProblem({ key: 'g'.repeat(32), connectionId: gcp.id, scope: 'my-project', source: 'gcp' }));
    insertProblem(db, newProblem({ key: 'a'.repeat(32), connectionId: aws.id, scope: 'us-east-1' }));

    const byProvider = new Map(readProblemsAcross(db, {}, context).problems.map((problem) => [problem.provider, problem.href]));
    expect(byProvider.get('gcp')).toBeNull();
    // And AWS keeps the link it always had, so this is about the cloud and not about links in general.
    expect(byProvider.get('aws')).toBe('/c/c1/us-east-1/containers/services/prod/web');
  });

  it('THE RULING: the counts are of everything, not of the filtered list', () => {
    // A count that changed when you filtered would be answering a different question from the one it
    // appears to answer — the same rule the connections page holds.
    const { db, aws, gcp } = twoClouds();
    insertProblem(db, newProblem({ key: 'a'.repeat(32), connectionId: aws.id }));
    insertProblem(db, newProblem({ key: 'b'.repeat(32), connectionId: aws.id, subjectId: 'prod/api' }));
    insertProblem(db, newProblem({ key: 'g'.repeat(32), connectionId: gcp.id, scope: 'my-project', source: 'gcp' }));

    const filtered = readProblemsAcross(db, { providers: ['gcp'] }, context);
    expect(filtered.problems).toHaveLength(1);
    expect(filtered.counts).toEqual({ total: 3, byProvider: { aws: 2, gcp: 1, do: 0 } });
  });

  it('filters to a cloud with no connections by showing none, not everything', () => {
    // An empty id list is a filter matching nothing. Dropped instead, it would quietly show all of
    // them under a chip that says otherwise.
    const { db, aws } = twoClouds();
    insertProblem(db, newProblem({ key: 'a'.repeat(32), connectionId: aws.id }));
    expect(readProblemsAcross(db, { providers: ['do'] }, context).problems).toEqual([]);
  });

  it('THE RULING: a problem that is over is not still wrong', () => {
    // This page is about what is wrong now. A resolved row shown among the open ones is an operator
    // chasing something that already ended, and it would be counted in the chips as well.
    const { db, aws } = twoClouds();
    const open = insertProblem(db, newProblem({ key: 'o'.repeat(32), connectionId: aws.id }));
    const over = insertProblem(db, newProblem({ key: 'r'.repeat(32), connectionId: aws.id, subjectId: 'prod/api' }));
    updateProblem(db, over.id, { status: 'resolved', resolvedAt: FIXED_NOW });

    const answer = readProblemsAcross(db, {}, context);
    expect(answer.problems.map((problem) => problem.id)).toEqual([open.id]);
    expect(answer.counts.total).toBe(1);
  });

  it('says when more are open than it shows, rather than implying the page is all of them', () => {
    const { db, aws } = twoClouds();
    for (let index = 0; index < ACROSS_LIMIT + 1; index += 1) {
      insertProblem(db, newProblem({ key: String(index).padStart(32, '0'), connectionId: aws.id, subjectId: `prod/${index}` }));
    }
    const answer = readProblemsAcross(db, {}, context);
    expect(answer.problems).toHaveLength(ACROSS_LIMIT);
    expect(answer.truncated).toBe(true);
  });

  it('names a connection that has gone rather than leaving a problem belonging to nothing', () => {
    const { db } = twoClouds();
    insertProblem(db, newProblem({ key: 'x'.repeat(32), connectionId: 'deleted', scope: 'us-east-1' }));
    const { problems, counts } = readProblemsAcross(db, {}, context);
    expect(problems[0].connectionName).toBe('');
    // And it is not counted under a cloud, because nothing says which cloud it was.
    expect(counts.total).toBe(0);
  });
});
