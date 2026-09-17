import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadTemplate } from '@/lib/aws/template-upload';

vi.mock('@/lib/aws/base-credentials', () => ({
  baseCredentials: () => async () => ({ accessKeyId: 'BASE-FROM-ENV', secretAccessKey: 'base' }),
}));

const s3 = mockClient(S3Client);

beforeEach(() => s3.reset());

describe('uploadTemplate', () => {
  it('uploads with the base credentials and follows bucket region redirects', async () => {
    s3.on(PutObjectCommand).resolves({});
    await uploadTemplate({ bucket: 'templates', connectionId: 'abc123def456', region: 'eu-west-1', body: 'yaml' });
    const call = s3.commandCalls(PutObjectCommand)[0];
    expect(call.args[0].input).toMatchObject({ Bucket: 'templates', Key: 'opswatch/templates/opswatch-abc123def456-v1.yaml' });
    const client = call.thisValue as S3Client;
    expect(client.config.followRegionRedirects).toBe(true);
    expect(await (client.config.credentials as () => Promise<unknown>)()).toMatchObject({ accessKeyId: 'BASE-FROM-ENV' });
  });
});
