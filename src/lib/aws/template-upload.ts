import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { clientConfig } from './client-config';
import { templateObjectKey } from './template';

/** Uses OpsWatch's base identity, which then also needs s3:PutObject on this bucket. */
export async function uploadTemplate(input: {
  bucket: string;
  connectionId: string;
  region: string;
  body: string;
}): Promise<void> {
  const client = new S3Client(clientConfig(input.region));
  await client.send(
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: templateObjectKey(input.connectionId),
      Body: input.body,
      ContentType: 'application/x-yaml',
    }),
  );
}
