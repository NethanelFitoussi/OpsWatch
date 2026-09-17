import { describe, expect, it } from 'vitest';
import { formString, formStrings } from '@/lib/forms/form-data';

describe('form data readers', () => {
  it('reads one field as a string, empty when missing', () => {
    const data = new FormData();
    data.append('name', 'prod');
    expect(formString(data, 'name')).toBe('prod');
    expect(formString(data, 'missing')).toBe('');
  });

  it('reads every value of a repeated field', () => {
    const data = new FormData();
    data.append('regions', 'eu-west-1');
    data.append('regions', 'us-east-1');
    expect(formStrings(data, 'regions')).toEqual(['eu-west-1', 'us-east-1']);
    expect(formStrings(data, 'missing')).toEqual([]);
  });
});
