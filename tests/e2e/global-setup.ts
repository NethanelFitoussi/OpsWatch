import { MOTO_URL } from './helpers';
import { resetMoto, seedMoto, waitForMoto } from './seed/moto-seed';

/** Runs once before all specs: a clean moto with the resources the monitoring specs expect. */
export default async function globalSetup() {
  await waitForMoto(MOTO_URL);
  await resetMoto(MOTO_URL);
  await seedMoto(MOTO_URL);
}
