// Burakhan Yılmaz, 2200005240
export class WsHub {
  #clients = new Map<number, Set<WebSocket>>();

  add(userId: number, socket: WebSocket) {
    let set = this.#clients.get(userId);
    if (!set) {
      set = new Set();
      this.#clients.set(userId, set);
    }
    set.add(socket);
  }

  remove(userId: number, socket: WebSocket) {
    const set = this.#clients.get(userId);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) this.#clients.delete(userId);
  }

  broadcast(userId: number, payload: { type: string; task: unknown }) {
    const set = this.#clients.get(userId);
    if (!set) return;
    const message = JSON.stringify(payload);
    for (const socket of set) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }
}

export class LoginRateLimiter {
  #fails = new Map<string, { n: number; reset: number }>();

  retryAfterSeconds(email: string, max = 5): number | null {
    const entry = this.#fails.get(email);
    const now = Date.now();
    if (!entry || entry.reset <= now) return null;
    if (entry.n < max) return null;
    return Math.max(1, Math.ceil((entry.reset - now) / 1000));
  }

  recordFailure(email: string, windowMs = 60_000) {
    const now = Date.now();
    const entry = this.#fails.get(email);
    if (!entry || entry.reset <= now) {
      this.#fails.set(email, { n: 1, reset: now + windowMs });
    } else {
      entry.n++;
    }
  }

  clear(email: string) {
    this.#fails.delete(email);
  }
}
