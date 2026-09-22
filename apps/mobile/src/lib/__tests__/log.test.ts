import { redact } from '../log';

/**
 * Every rule gets a case that only it can catch.
 *
 * "Authorization: Bearer <token>" is caught twice over, by the header rule and by the bare-bearer rule, so a test
 * using only that string passes with either one deleted. A token reaches the log without the header around it often
 * enough -- an error message quoting a request, a curl snippet someone pasted -- that the second rule has to be
 * covered on its own.
 */
describe('redact', () => {
  it.each([
    ['Authorization: Bearer abc.def.ghi', 'abc.def.ghi'],
    ['Authorization: abc.def.ghi', 'abc.def.ghi'],
    ['retrying with Bearer abc.def.ghi', 'abc.def.ghi'],
    ['github_pat_11ABCDEFGHIJKLMNOPQRSTUV', 'github_pat_11ABCDEFGHIJKLMNOPQRSTUV'],
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
