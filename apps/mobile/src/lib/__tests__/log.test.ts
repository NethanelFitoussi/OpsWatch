import { redact } from '../log';

describe('redact', () => {
  it.each([
    ['Authorization: Bearer abc.def.ghi', 'abc.def.ghi'],
    ['{"password":"hunter2hunter2"}', 'hunter2hunter2'],
    ['token=s3cr3t-value-123', 's3cr3t-value-123'],
    ['key AKIAABCDEFGHIJKLMNOP leaked', 'AKIAABCDEFGHIJKLMNOP'],
    ['aws secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['gh token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['ai key sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'],
    ['push ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', 'xxxxxxxxxxxxxxxxxxxxxx'],
    ['{"code_verifier":"verifier-value"}', 'verifier-value'],
  ])('removes the secret from %s', (input, secret) => {
    const output = redact(input);
    expect(output).not.toContain(secret);
    expect(output).toContain('redacted');
  });

  it('keeps harmless text and summarises errors without stacks', () => {
    expect(redact('Server info refresh failed')).toBe('Server info refresh failed');
    expect(redact(new Error('boom'))).toBe('Error: boom');
    expect(redact({ status: 500 })).toBe('{"status":500}');
  });
});
