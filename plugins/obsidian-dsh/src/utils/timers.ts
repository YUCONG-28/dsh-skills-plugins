export type Timer = ReturnType<typeof setTimeout>;

export function setTimer(fn: () => void, ms: number): Timer {
  return setTimeout(fn, ms);
}

export function clearTimer(timer: Timer | null): void {
  if (timer) clearTimeout(timer);
}
