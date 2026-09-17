/** State returned by a form Server Action: an error code plus the extra, non-secret fields the form echoes back. */
export type ActionState<E extends string, Extra extends object = object> = { error?: E } & Partial<Extra>;

/** A Server Action bound to its leading arguments, as `useActionState` calls it. */
export type FormAction<S> = (prev: S, data: FormData) => Promise<S>;
