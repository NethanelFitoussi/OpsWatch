import 'server-only';
import { createDocument, type ZodOpenApiObject, type ZodOpenApiPathItemObject } from 'zod-openapi';
import { API_ERROR_STATUS, API_PREFIX, API_VERSION, apiErrorBodySchema, filtersFor, type ApiErrorCode } from '@opswatch/contract';
import { version } from '../../../../package.json';
import { API_ROUTES, COMMON_ERRORS, type ApiRouteSpec } from './routes';

/**
 * The OpenAPI document, generated from the same zod schemas the routes answer with. It is never hand-written, so it
 * cannot describe a shape the server does not actually send: change the contract and the document changes with it.
 */
export function openApiDocument(): ReturnType<typeof createDocument> {
  const paths: Record<string, ZodOpenApiPathItemObject> = {};
  for (const route of API_ROUTES) {
    const path = `${API_PREFIX}${route.path}`;
    paths[path] = { ...paths[path], [route.method]: operation(route) };
  }
  const document: ZodOpenApiObject = {
    openapi: '3.1.0',
    info: {
      title: 'OpsWatch',
      version,
      description: `Version ${API_VERSION} of the OpsWatch API. Times are epoch milliseconds, and a value that could not be measured is null, never 0. Inside v1 only additive changes are made, so a client must ignore fields it does not know.`,
    },
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'A token from POST /auth/login. Non-browser clients only.' },
        session: { type: 'apiKey', in: 'cookie', name: 'opswatch_session', description: 'The browser session cookie.' },
      },
    },
    paths,
  };
  return createDocument(document, {
    // Zod strips unknown keys, which `toJSONSchema` renders as `additionalProperties: false`. That would say the
    // opposite of what v1 promises: it only ever adds fields, and a client is expected to ignore the ones it does
    // not know yet. Declaring "no other properties" would make every additive release look like a breaking one.
    override: (context) => {
      if (context.jsonSchema.additionalProperties === false) delete context.jsonSchema.additionalProperties;
    },
  });
}

/** Every `{name}` a path template carries. OpenAPI requires each one to be declared, or a generated client drops it. */
const PATH_PARAM = /\{(\w+)\}/g;

/**
 * The path parameters of a route, derived from its own template rather than listed a second time: the two could
 * otherwise disagree, and the one that reaches a client generator is this one.
 */
function pathParameters(route: ApiRouteSpec) {
  const names = [...route.path.matchAll(PATH_PARAM)].map((match) => match[1]);
  const parameters = [
    ...names.map((name) => ({
      name,
      in: 'path' as const,
      required: true,
      schema: { type: 'string' as const },
      ...(route.pathParams?.[name] === undefined ? {} : { description: route.pathParams[name] }),
    })),
    ...queryParameters(route.path),
  ];
  return parameters.length === 0 ? {} : { parameters };
}

/**
 * The filters a list endpoint accepts, derived from the contract's `LIST_FILTERS` rather than written out
 * again here. A filter the server honours but the document omits is undiscoverable, which is how the mobile
 * client came to invent its own request vocabulary in the first place.
 */
function queryParameters(path: string) {
  const filters = filtersFor(path);
  if (filters === null) return [];
  return Object.entries(filters).map(([name, kind]) => ({
    name,
    in: 'query' as const,
    required: false,
    // An enum filter is repeatable — `?status=new&status=active` means either — so it is an array.
    schema:
      kind === 'epoch'
        ? { type: 'integer' as const, description: 'Epoch milliseconds' }
        : kind === 'enum'
          ? { type: 'array' as const, items: { type: 'string' as const } }
          : { type: 'string' as const },
  }));
}

function operation(route: ApiRouteSpec) {
  const byStatus = new Map<number, ApiErrorCode[]>();
  for (const error of new Set([...route.errors, ...COMMON_ERRORS])) {
    const status = API_ERROR_STATUS[error];
    byStatus.set(status, [...(byStatus.get(status) ?? []), error]);
  }
  return {
    operationId: route.operationId,
    summary: route.summary,
    // An empty list means "no credential needed"; the other routes accept either credential.
    security: route.auth === 'none' ? [] : [{ bearer: [] }, { session: [] }],
    ...pathParameters(route),
    ...(route.request ? { requestBody: { content: { 'application/json': { schema: route.request } } } } : {}),
    responses: {
      [String(route.status)]: {
        description: 'Success.',
        ...(route.response ? { content: { 'application/json': { schema: route.response } } } : {}),
      },
      ...Object.fromEntries(
        [...byStatus].map(([status, errors]) => [
          String(status),
          {
            description: `error: ${errors.join(' | ')}`,
            content: { 'application/json': { schema: apiErrorBodySchema } },
          },
        ]),
      ),
    },
  };
}
