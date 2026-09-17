import 'server-only';
import { createLoginThrottle } from './login-throttle';
import { createRateLimiter } from './rate-limit';

// Per client: 5 attempts per minute, cleared after a successful sign-in. The client key comes
// from headers a direct caller can forge, so this only slows down honest-looking clients.
export const loginLimiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
// All clients together: once more than 20 sign-ins failed in the last minute, passwords are
// verified one at a time, at least 3 seconds apart, and attempts beyond 50 waiting are refused.
// This bounds online password guessing without locking the admin out.
export const loginThrottle = createLoginThrottle();
