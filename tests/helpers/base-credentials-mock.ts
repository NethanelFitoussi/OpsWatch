// Stands in for @/lib/aws/base-credentials: vi.mock('@/lib/aws/base-credentials', () => import('../helpers/base-credentials-mock')).
import { BASE_CREDENTIALS } from './aws';

export const baseCredentials = () => async () => BASE_CREDENTIALS;
