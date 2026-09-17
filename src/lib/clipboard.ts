function copyWithTextarea(value: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  Object.assign(textarea.style, { position: 'fixed', opacity: '0' });
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

/**
 * Copies text and tells whether it worked. `navigator.clipboard` only exists in a secure context, and a
 * self-hosted install is often served over plain HTTP, so the deprecated execCommand copy is the fallback.
 */
export async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Refused (permissions, focus): try the fallback.
  }
  return copyWithTextarea(value);
}
