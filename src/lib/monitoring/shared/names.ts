// URL segments are checked against AWS naming rules before any lookup, so they never need decoding tricks.
export const isEcsName = (value: string) => /^[A-Za-z0-9_-]{1,255}$/.test(value);
export const isDbInstanceId = (value: string) => /^[A-Za-z][A-Za-z0-9-]{0,62}$/.test(value);
export const isLoadBalancerName = (value: string) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,30}[A-Za-z0-9])?$/.test(value);
