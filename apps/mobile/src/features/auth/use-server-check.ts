/**
 * The connection test of the Connect screen: validates the URL, asks the server who it is, and checks that it speaks
 * the mobile API version this app understands. No credentials are involved.
 */
import { useState } from 'react';
import { createHttpClient } from '@/api/client';
import { API_VERSION, type ServerInfo } from '@/api/contract';
import { isApiError } from '@/api/errors';
import type { MessageKey, Params } from '@/i18n';
import { parseServerUrl } from '@/lib/server-url';

export type ServerCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; url: string; insecure: boolean; info: ServerInfo }
  | { status: 'error'; message: MessageKey; params?: Params };

/**
 * Turns a failed connection test into something the person can act on. Each case says what probably went wrong and
 * what to try, because this screen is the first thing a new user meets and a dead end here ends the install.
 */
export function describeCheckError(error: unknown): { message: MessageKey } {
  if (!isApiError(error)) return { message: 'connect.error.unreachable' };
  switch (error.kind) {
    case 'not_found':
      // Something is there, but not at this path: OpsWatch behind a sub-path is the usual cause.
      return { message: 'connect.error.notFoundHere' };
    case 'invalid_response':
      // An answer that is not the OpsWatch API: a proxy, a captive portal or a login page in front of it.
      return { message: 'connect.error.notOpsWatch' };
    case 'network':
      return { message: 'connect.error.unreachable' };
    case 'timeout':
      return { message: 'connect.error.timeout' };
    case 'unauthorized':
    case 'forbidden':
      // `GET /server` needs no credentials, so something in front of the server is asking for them.
      return { message: 'connect.error.blocked' };
    default:
      return { message: `error.${error.kind}` as MessageKey };
  }
}

export function useServerCheck(options: { allowInsecureLocal: boolean; locale: string }) {
  const [check, setCheck] = useState<ServerCheck>({ status: 'idle' });

  async function run(input: string): Promise<ServerCheck> {
    const parsed = parseServerUrl(input, { allowInsecureLocal: options.allowInsecureLocal });
    if (!parsed.ok) {
      const result: ServerCheck = { status: 'error', message: `connect.error.${parsed.reason}` as MessageKey };
      setCheck(result);
      return result;
    }
    setCheck({ status: 'checking' });
    let result: ServerCheck;
    try {
      const info = await createHttpClient({ baseUrl: parsed.url, getToken: () => null, locale: options.locale }).getServerInfo();
      result =
        info.apiVersion === API_VERSION
          ? { status: 'ok', url: parsed.url, insecure: parsed.insecure, info }
          : {
              status: 'error',
              message: 'connect.error.apiVersion',
              params: { server: info.apiVersion, app: API_VERSION, older: info.apiVersion < API_VERSION ? 'server' : 'app' },
            };
    } catch (error) {
      result = { status: 'error', ...describeCheckError(error) };
    }
    setCheck(result);
    return result;
  }

  return { check, run, reset: () => setCheck({ status: 'idle' }) };
}
