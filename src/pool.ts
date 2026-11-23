// Burakhan Yılmaz, 2200005240
import { createDb, type Db } from "./db.ts";

export class Pool<T> {
  #idle: T[];
  #waiting: ((item: T) => void)[] = [];

  constructor(items: T[]) {
    this.#idle = [...items];
  }

  acquire(): Promise<T> {
    const item = this.#idle.pop();
    if (item !== undefined) return Promise.resolve(item);
    return new Promise((resolve) => this.#waiting.push(resolve));
  }

  release(item: T) {
    const next = this.#waiting.shift();
    if (next) next(item);
    else this.#idle.push(item);
  }

  async use<R>(fn: (item: T) => Promise<R>): Promise<R> {
    const item = await this.acquire();
    try {
      return await fn(item);
    } finally {
      this.release(item);
    }
  }
}

export async function createSqlitePool(url: string, size = 3): Promise<Pool<Db>> {
  const conns: Db[] = [];
  for (let i = 0; i < size; i++) {
    const conn = createDb(url);
    await conn.client.execute("PRAGMA journal_mode=WAL");
    await conn.client.execute("PRAGMA busy_timeout=5000");
    conns.push(conn);
  }
  return new Pool(conns);
}
