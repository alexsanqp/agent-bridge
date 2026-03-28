export function now(): string {
  return new Date().toISOString();
}

export function expiresAt(minutes: number = 30): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

export function isExpired(expiresAt: string | null): boolean {
  if (expiresAt === null) {
    return false;
  }
  return new Date(expiresAt).getTime() < Date.now();
}
