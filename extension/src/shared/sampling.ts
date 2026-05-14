export function shouldSample(rate: number): boolean {
  if (rate >= 1.0) return true;
  if (rate <= 0.0) return false;
  return Math.random() < rate;
}
