import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { env } from '../config/env';

export interface JobContext {
  name: string;
  data: Record<string, any>;
}

export type JobHandler = (job: JobContext) => Promise<void>;

export interface QueueDriver {
  readonly mode: 'bullmq' | 'memory';
  enqueue(name: string, data: Record<string, any>, delayMs: number): Promise<void>;
  register(name: string, handler: JobHandler): Promise<void>;
  close(): Promise<void>;
}

/**
 * In-process driver: same semantics as BullMQ (delayed jobs, async
 * processing) without requiring a Redis server. Used automatically when
 * QUEUE_DRIVER=auto and Redis is unreachable, and forced in tests.
 * The production/docker profile uses BullMQ (QUEUE_DRIVER=bullmq).
 */
class MemoryDriver implements QueueDriver {
  readonly mode = 'memory' as const;
  private readonly handlers = new Map<string, JobHandler>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private closed = false;

  async enqueue(name: string, data: Record<string, any>, delayMs: number): Promise<void> {
    if (this.closed) throw new Error('Queue is closed');
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.run(name, data);
    }, Math.max(0, delayMs));
    timer.unref?.();
    this.timers.add(timer);
  }

  private async run(name: string, data: Record<string, any>): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) {
      // eslint-disable-next-line no-console
      console.warn(`[queue:memory] no handler registered for job "${name}"`);
      return;
    }
    try {
      await handler({ name, data });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[queue:memory] job "${name}" failed:`, err);
    }
  }

  async register(name: string, handler: JobHandler): Promise<void> {
    this.handlers.set(name, handler);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

/**
 * BullMQ driver — used when Redis is available (docker-compose profile).
 * Registered lazily so restricted environments fall back to memory.
 */
class BullMqDriver implements QueueDriver {
  readonly mode = 'bullmq' as const;
  private readonly queues = new Map<string, any>();
  private readonly workers: any[] = [];
  private readonly redis: any;

  constructor(redisUrl: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Queue, Worker } = require('bullmq');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IORedis = require('ioredis');
    this.redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      reconnectOnError: () => true,
    });
    this.redis.on('error', () => {
      /* logged in probe */
    });
    this.QueueClass = Queue;
    this.WorkerClass = Worker;
  }

  private readonly QueueClass: any;
  private readonly WorkerClass: any;

  private queue(name: string) {
    if (!this.queues.has(name)) {
      this.queues.set(
        name,
        new this.QueueClass(name, { connection: this.createConnection() }),
      );
    }
    return this.queues.get(name);
  }

  private createConnection() {
    const IORedis = require('ioredis');
    return new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }

  async enqueue(name: string, data: Record<string, any>, delayMs: number): Promise<void> {
    await this.queue('payledger').add(name, data, {
      delay: Math.max(0, delayMs),
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }

  async register(name: string, handler: JobHandler): Promise<void> {
    const worker = new this.WorkerClass(
      'payledger',
      async (job: any) => {
        if (job.name === name) await handler({ name: job.name, data: job.data });
      },
      { connection: this.createConnection(), concurrency: 5 },
    );
    worker.on('failed', (job: any, err: Error) => {
      // eslint-disable-next-line no-console
      console.error(`[queue:bullmq] job ${job?.name} failed:`, err.message);
    });
    this.workers.push(worker);
  }

  async close(): Promise<void> {
    for (const w of this.workers) await w.close();
    for (const q of this.queues.values()) await q.close();
    try {
      await this.redis.quit();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Job queue facade. Jobs: `payroll.process`, `ach.settle`.
 * Driver selection: explicit QUEUE_DRIVER, or auto-detect Redis for `auto`.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private driver: QueueDriver = new MemoryDriver();
  private readonly logger = new Logger(QueueService.name);

  async onModuleInit(): Promise<void> {
    this.driver = await this.resolveDriver();
    this.logger.log(`queue driver: ${this.driver.mode}`);
  }

  private async resolveDriver(): Promise<QueueDriver> {
    if (env.queueDriver === 'memory') return new MemoryDriver();
    if (env.queueDriver === 'bullmq') return this.tryBullMq() ?? new MemoryDriver();
    // auto: probe Redis with a short timeout
    const probed = await this.probeRedis(1500);
    if (probed) {
      const driver = this.tryBullMq();
      if (driver) return driver;
    }
    return new MemoryDriver();
  }

  private tryBullMq(): QueueDriver | null {
    try {
      return new BullMqDriver(env.redisUrl);
    } catch (err) {
      this.logger.warn(`BullMQ unavailable, falling back to memory driver: ${String(err)}`);
      return null;
    }
  }

  private async probeRedis(timeoutMs: number): Promise<boolean> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require('ioredis');
      const client = new IORedis(env.redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        connectTimeout: timeoutMs,
        retryStrategy: () => null,
      });
      client.on('error', () => undefined);
      await client.connect();
      const pong = await Promise.race([
        client.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
      ]);
      await client.quit().catch(() => undefined);
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  get mode(): 'bullmq' | 'memory' {
    return this.driver.mode;
  }

  enqueue(name: string, data: Record<string, any>, delayMs: number): Promise<void> {
    return this.driver.enqueue(name, data, delayMs);
  }

  register(name: string, handler: JobHandler): Promise<void> {
    return this.driver.register(name, handler);
  }

  async onModuleDestroy(): Promise<void> {
    await this.driver.close();
  }
}

@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
