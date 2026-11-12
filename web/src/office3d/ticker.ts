// Dedicated worker clock. Browsers slow down or pause requestAnimationFrame and page timers when
// the window is not in front; worker timers keep ticking, so the office keeps living.

const scope = globalThis as unknown as { postMessage(message: unknown): void };
setInterval(() => scope.postMessage(0), 33);
