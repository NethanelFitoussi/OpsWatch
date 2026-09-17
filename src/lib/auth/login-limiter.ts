import 'server-only';
import { createRateLimiter } from './rate-limit';

// Per client: 5 attempts per minute, cleared after a successful sign-in.
export const loginLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
// All clients together: 20 attempts per minute, cleared after a successful sign-in. The client key comes from headers a
// direct caller can forge, so this cap is what actually bounds online password guessing
// against the single admin account.
export const globalLoginLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });
export const GLOBAL_LOGIN_KEY = 'all';
