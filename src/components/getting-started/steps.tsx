import { AmbientSteps } from './ambient-steps';
import { KeysSteps } from './keys-steps';
import { RoleSteps } from './role-steps';

/** The three step-by-step guides, one per connection method. */
export function Steps() {
  return (
    <div className="space-y-16">
      <RoleSteps />
      <AmbientSteps />
      <KeysSteps />
    </div>
  );
}
