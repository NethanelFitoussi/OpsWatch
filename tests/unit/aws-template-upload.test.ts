import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadTemplate } from '@/lib/aws/template-upload';
import { BASE_CREDENTIALS, expectSignedWith } from '../helpers/aws';

vi.mock('@/lib/aws/base-credentials', () => import('../helpers/base-credentials-mock'));

const s3 = mockClient(S3Client);

beforeEach(() => s3.reset());
afterEach(() => {
  vi.useRealTimers();
});

describe('uploadTemplate', () => {
  it('uploads with the base credentials and follows bucket region redirects', async () => {
    s3.on(PutObjectCommand).resolves({});
    await uploadTemplate({ bucket: 'templates', connectionId: 'abc123def456', region: 'eu-west-1', body: 'yaml' });
    const call = s3.commandCalls(PutObjectCommand)[0];
    expect(call.args[0].input).toMatchObject({ Bucket: 'templates', Key: 'opswatch/templates/opswatch-abc123def456-v1.yaml' });
    const client = call.thisValue as S3Client;
    expect(client.config.followRegionRedirects).toBe(true);
    await expectSignedWith(client, BASE_CREDENTIALS.accessKeyId);
  });

  it('gives up after 5 seconds', async () => {
    vi.useFakeTimers();
    s3.on(PutObjectCommand).callsFake(() => new Promise(() => {}));
    const upload = uploadTemplate({ bucket: 'templates', connectionId: 'abc123def456', region: 'eu-west-1', body: 'yaml' });
    const outcome = expect(upload).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(5000);
    await outcome;
  });
});
