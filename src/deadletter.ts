import { Pool } from "@db/postgres";
import {
  DeadLetterEntry,
  DeadLetterQueue,
  Event,
  PostgresDeadLetterQueueOptions,
} from "./types.ts";

/**
 * In-memory implementation of a dead letter queue
 * Stores events that failed to process after all retries
 */
export class SimpleDeadLetterQueue implements DeadLetterQueue {
  private entries: Map<string, DeadLetterEntry> = new Map();

  /**
   * Add a failed event to the dead letter queue
   */
  addEvent(
    event: Event,
    error: Error,
    subscriptionName: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.entries.set(event.id, {
        event,
        error: error.message,
        subscription: subscriptionName,
        timestamp: Date.now(),
        attempts: 1,
      });
      resolve();
    });
  }

  /**
   * Get failed events from the queue with optional filtering
   */
  getEvents(
    options: {
      topic?: string;
      eventType?: string;
      limit?: number;
    } = {},
  ): Promise<DeadLetterEntry[]> {
    return new Promise((resolve) => {
      let entries = Array.from(this.entries.values());

      // Apply filters
      if (options.topic) {
        entries = entries.filter(
          (entry) => entry.event.topic === options.topic,
        );
      }

      if (options.eventType) {
        entries = entries.filter(
          (entry) => entry.event.type === options.eventType,
        );
      }

      // Sort by timestamp (newest first)
      entries.sort((a, b) => b.timestamp - a.timestamp);

      // Apply limit if specified
      if (options.limit && options.limit > 0) {
        entries = entries.slice(0, options.limit);
      }

      resolve(entries);
    });
  }

  /**
   * Retry processing a failed event
   * Returns true if the event was found and retried
   */
  retryEvent(eventId: string): Promise<boolean> {
    return new Promise((resolve) => {
      const entry = this.entries.get(eventId);
      if (!entry) {
        return resolve(false);
      }

      // Increment attempt count
      entry.attempts += 1;
      return resolve(true);
    });
  }

  /**
   * Remove an event from the dead letter queue
   */
  removeEvent(eventId: string): Promise<boolean> {
    return new Promise((resolve) => {
      resolve(this.entries.delete(eventId));
    });
  }
}

/**
 * File-based implementation of a dead letter queue
 * More durable than the in-memory implementation
 */
export class FileDeadLetterQueue implements DeadLetterQueue {
  private baseDir: string;

  constructor(baseDir: string = "./dead_letter_queue") {
    this.baseDir = baseDir;
    this.ensureBaseDir();
  }

  private async ensureBaseDir(): Promise<void> {
    try {
      await Deno.stat(this.baseDir);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await Deno.mkdir(this.baseDir, { recursive: true });
      } else {
        throw error;
      }
    }
  }

  async addEvent(
    event: Event,
    error: Error,
    subscriptionName: string,
  ): Promise<void> {
    const entry: DeadLetterEntry = {
      event,
      error: error.message,
      subscription: subscriptionName,
      timestamp: Date.now(),
      attempts: 1,
    };

    const filename = `${this.baseDir}/${event.id}.json`;
    await Deno.writeTextFile(filename, JSON.stringify(entry));
  }

  async getEvents(
    options: {
      topic?: string;
      eventType?: string;
      limit?: number;
    } = {},
  ): Promise<DeadLetterEntry[]> {
    const entries: DeadLetterEntry[] = [];

    try {
      for await (const dirEntry of Deno.readDir(this.baseDir)) {
        if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
          const filePath = `${this.baseDir}/${dirEntry.name}`;
          const content = await Deno.readTextFile(filePath);
          const entry = JSON.parse(content) as DeadLetterEntry;

          // Apply filters
          if (options.topic && entry.event.topic !== options.topic) {
            continue;
          }

          if (options.eventType && entry.event.type !== options.eventType) {
            continue;
          }

          entries.push(entry);
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        throw error;
      }
      // Directory not found means no entries
    }

    // Sort by timestamp (newest first)
    entries.sort((a, b) => b.timestamp - a.timestamp);

    // Apply limit if specified
    if (options.limit && options.limit > 0) {
      return entries.slice(0, options.limit);
    }

    return entries;
  }

  async retryEvent(eventId: string): Promise<boolean> {
    const filename = `${this.baseDir}/${eventId}.json`;

    try {
      // Read existing entry
      const content = await Deno.readTextFile(filename);
      const entry = JSON.parse(content) as DeadLetterEntry;

      // Increment attempt count
      entry.attempts += 1;

      // Update the file
      await Deno.writeTextFile(filename, JSON.stringify(entry));
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  async removeEvent(eventId: string): Promise<boolean> {
    const filename = `${this.baseDir}/${eventId}.json`;

    try {
      await Deno.remove(filename);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }
}

/**
 * PostgreSQL-based dead letter queue implementation for production use.
 * Provides scalable, durable storage with robust filtering and retry capabilities
 */
export class PostgresDeadLetterQueue implements DeadLetterQueue {
  private pool: Pool;
  private isInitialized = false;
  private options: PostgresDeadLetterQueueOptions;

  constructor(pool: Pool, options: PostgresDeadLetterQueueOptions = {
    tableName: "events_dlq",
    idType: "uuid",
  }) {
    this.pool = pool;
    this.options = options;
  }

  /**
   * Initialize the database schema if needed
   */
  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    const client = await this.pool.connect();
    try {
      // Create the dead letter queue table if it doesn't exist
      await client.queryObject(`
        CREATE TABLE IF NOT EXISTS ${this.options.tableName} (
          event_id TEXT PRIMARY KEY,
          event_data JSONB NOT NULL,
          error TEXT NOT NULL,
          subscription TEXT NOT NULL,
          timestamp BIGINT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create indexes for faster querying
      await client.queryObject(`
        CREATE INDEX IF NOT EXISTS dlq_topic_idx ON ${this.options.tableName} ((event_data->>'topic'));
        CREATE INDEX IF NOT EXISTS dlq_type_idx ON ${this.options.tableName} ((event_data->>'type'));
        CREATE INDEX IF NOT EXISTS dlq_timestamp_idx ON ${this.options.tableName} (timestamp);
        CREATE INDEX IF NOT EXISTS dlq_subscription_idx ON ${this.options.tableName} (subscription);  
      `);

      this.isInitialized = true;
    } finally {
      client.release();
    }
  }

  /**
   * Add a failed event to the dead letter queue
   */
  async addEvent(event: Event, error: Error, subscriptionName: string): Promise<void> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const query = `
        INSERT INTO ${this.options.tableName} (event_id, event_data, error, subscription, timestamp, attempts)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (event_id) DO UPDATE
        SET attempts = ${this.options.idType === "uuid" ? "attempts + 1" : "attempts"},
          error = $3,
          last_updated = CURRENT_TIMESTAMP
      `;

      await client.queryObject(query, [
        event.id,
        JSON.stringify(event),
        error.message,
        subscriptionName,
        Date.now(),
        this.options.idType === "uuid" ? 1 : 0,
      ]);
    } finally {
      client.release();
    }
  }

  /**
   * Get failed events from the queue with optional filtering
   */
  async getEvents(
    options: {
      topic?: string;
      eventType?: string;
      limit?: number;
    } = {},
  ): Promise<DeadLetterEntry[]> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      // Build the query with parameters
      let queryText = `
        SELECT event_id, event_data, error, subscription, timestamp, attempts
        FROM ${this.options.tableName}
        WHERE 1=1
      `;

      const queryParams: Array<string | number> = [];
      let paramIndex = 1;

      // Add topic filter if specified
      if (options.topic) {
        queryText += ` AND event_data->>'topic' = $${paramIndex}`;
        queryParams.push(options.topic);
        paramIndex++;
      }

      // Add event type filter if specified
      if (options.eventType) {
        queryText += ` AND event_data->>'type' = $${paramIndex}`;
        queryParams.push(options.eventType);
        paramIndex++;
      }

      // Order by timestamp (newest first)
      queryText += ` ORDER BY timestamp DESC`;

      // Add limit if specified
      if (options.limit) {
        queryText += ` LIMIT $${paramIndex}`;
        queryParams.push(options.limit);
      }

      const result = await client.queryObject<{
        event_id: string;
        event_data: string;
        error: string;
        subscription: string;
        timestamp: number;
        attempts: number;
      }>(queryText, queryParams);

      // Convert rows to DeadLetterEntry objects
      return result.rows.map((row) => ({
        event: JSON.parse(row.event_data),
        error: row.error,
        subscription: row.subscription,
        timestamp: row.timestamp,
        attempts: row.attempts,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Retry processing a failed event
   * Returns true if the event was found and retried
   */
  async retryEvent(eventId: string): Promise<boolean> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const result = await client.queryObject(
        `
        UPDATE ${this.options.tableName}
        SET attempts = attempts + 1,
            last_updated = CURRENT_TIMESTAMP
        WHERE event_id = $1
        RETURNING event_id
      `,
        [eventId],
      );

      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Remove an event from the dead letter queue
   */
  async removeEvent(eventId: string): Promise<boolean> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const result = await client.queryObject(
        `
        DELETE FROM ${this.options.tableName}
        WHERE event_id = $1
        RETURNING event_id
      `,
        [eventId],
      );

      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * Close the database connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
