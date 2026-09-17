/** Narrows a string to one of the literal members of `list`. */
export function isOneOf<T extends string>(list: readonly T[], value: string | null | undefined): value is T {
  return value != null && (list as readonly string[]).includes(value);
}
