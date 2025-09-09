import IORedis from "ioredis";

type QueueEntry = { playerId: string; rating?: number; socketId?: string; ts: number };

const QUEUE_KEY = "ttt:matchmaking:queue";

export class Matchmaker {
  redis?: IORedis;
  inMemoryQueue: QueueEntry[] = [];
  useRedis = false;

  constructor(redisUrl?: string) {
    if (redisUrl) {
      try {
        this.redis = new IORedis(redisUrl);
        this.useRedis = true;
      } catch (e) {
        console.warn("Failed to init redis, using in-memory fallback");
        this.useRedis = false;
      }
    }
  }

  async enqueue(entry: QueueEntry) {
    entry.ts = Date.now();
    if (this.useRedis && this.redis) {
      await this.redis.rpush(QUEUE_KEY, JSON.stringify(entry));
      return;
    }
    this.inMemoryQueue.push(entry);
  }

  async dequeue(): Promise<QueueEntry | null> {
    if (this.useRedis && this.redis) {
      const raw = await this.redis.lpop(QUEUE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    }
    return this.inMemoryQueue.shift() || null;
  }

  // simple pairing: take two entries (FIFO), optionally match rating within window
  async tryMatch(): Promise<[QueueEntry, QueueEntry] | null> {
    const a = await this.dequeue();
    if (!a) return null;
    const b = await this.dequeue();
    if (!b) {
      // put a back
      await this.enqueue(a);
      return null;
    }
    return [a, b];
  }
}
