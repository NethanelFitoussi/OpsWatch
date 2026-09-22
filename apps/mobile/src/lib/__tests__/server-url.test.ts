import { displayServer, isPrivateHost, parseServerUrl } from '../server-url';

const secure = { allowInsecureLocal: false };
const dev = { allowInsecureLocal: true };

describe('parseServerUrl', () => {
  it('assumes https and normalises', () => {
    expect(parseServerUrl('ops.example.com', secure)).toEqual({ ok: true, url: 'https://ops.example.com', insecure: false });
    expect(parseServerUrl(' https://ops.example.com/ ', secure)).toEqual({ ok: true, url: 'https://ops.example.com', insecure: false });
    expect(parseServerUrl('https://example.com/ops/', secure)).toMatchObject({ ok: true, url: 'https://example.com/ops' });
    expect(parseServerUrl('https://ops.example.com:8443', secure)).toMatchObject({ ok: true, url: 'https://ops.example.com:8443' });
  });

  it('refuses plain HTTP unless it is a local host in a development build with explicit opt-in', () => {
    expect(parseServerUrl('http://ops.example.com', secure)).toEqual({ ok: false, reason: 'insecure_not_allowed' });
    expect(parseServerUrl('http://ops.example.com', dev)).toEqual({ ok: false, reason: 'insecure_not_allowed' });
    expect(parseServerUrl('http://localhost:4010', secure)).toEqual({ ok: false, reason: 'insecure_not_allowed' });
    expect(parseServerUrl('http://localhost:4010', dev)).toEqual({ ok: true, url: 'http://localhost:4010', insecure: true });
    expect(parseServerUrl('http://10.0.2.2:4010', dev)).toMatchObject({ ok: true, insecure: true });
    expect(parseServerUrl('http://192.168.1.20:3000', dev)).toMatchObject({ ok: true });
  });

  it('rejects dangerous or malformed input', () => {
    expect(parseServerUrl('', secure)).toEqual({ ok: false, reason: 'empty' });
    expect(parseServerUrl('https://user:pass@ops.example.com', secure)).toEqual({ ok: false, reason: 'credentials_in_url' });
    expect(parseServerUrl('https://ops.example.com/?token=x', secure)).toEqual({ ok: false, reason: 'has_query' });
    expect(parseServerUrl('ftp://ops.example.com', secure)).toEqual({ ok: false, reason: 'unsupported_scheme' });
    expect(parseServerUrl('javascript://alert(1)', secure)).toMatchObject({ ok: false });
    expect(parseServerUrl('https://', secure)).toMatchObject({ ok: false });
  });
});

it('recognises private hosts only', () => {
  for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.10', 'nas.local']) expect(isPrivateHost(host)).toBe(true);
  for (const host of ['8.8.8.8', '172.32.0.1', 'example.com', 'localhost.example.com']) expect(isPrivateHost(host)).toBe(false);
});

it('shortens server urls for display', () => {
  expect(displayServer('https://ops.example.com/ops')).toBe('ops.example.com/ops');
});
