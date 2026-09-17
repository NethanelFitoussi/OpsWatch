/** One form field as a string; empty when the field is missing. */
export function formString(data: FormData, name: string): string {
  return String(data.get(name) ?? '');
}

/** Every value of a repeated form field (checkboxes sharing a name). */
export function formStrings(data: FormData, name: string): string[] {
  return data.getAll(name).map(String);
}
