import { Pool } from "@db/postgres";
import { Event, EventStore, PostgresEventStoreOptions } from "./types.ts";

/**
 * In-memory implementation of event storage.
 * In a production environment, this would be replaced with a database-backed implementation
 */
export class InMemoryEventStore implements EventStore {
  private events: Map<string, Event[]> = new Map();

  /**
   * Save an event to storage
   */
  saveEvent(event: Event): Promise<void> {
    return new Promise((resolve) => {
      if (!this.events.has(event.topic)) {
        this.events.set(event.topic, []);
      }

      this.events.get(event.topic)!.push(event);
      resolve();
    });
  }

  /**
   * Get events for a topic with optional filtering
   */
  getEvents(
    topic: string,
    options: {
      fromTimestamp?: number;
      toTimestamp?: number;
      limit?: number;
      eventTypes?: string[];
    } = {},
  ): Promise<Event[]> {
    return new Promise((resolve) => {
      if (!this.events.has(topic)) {
        resolve([]);
        return;
      }

      let events = this.events.get(topic)!;

      // Apply timestamp filters
      if (options.fromTimestamp) {
        events = events.filter((e) => e.timestamp >= options.fromTimestamp!);
      }

      if (options.toTimestamp) {
        events = events.filter((e) => e.timestamp <= options.toTimestamp!);
      }

      // Filter by event types if specified
      if (options.eventTypes?.length) {
        events = events.filter((e) => options.eventTypes!.includes(e.type));
      }

      // Sort by timestamp (oldest first)
      events = events.sort((a, b) => a.timestamp - b.timestamp);

      // Apply limit if specified
      if (options.limit) {
        events = events.slice(0, options.limit);
      }

      resolve(events);
    });
  }

  /**
   * Delete events before a specific timestamp
   */
  deleteEvents(topic: string, beforeTimestamp: number): Promise<number> {
    return new Promise((resolve) => {
      if (!this.events.has(topic)) {
        resolve(0);
        return;
      }

      const events = this.events.get(topic)!;
      const initialCount = events.length;

      // Filter out events that are older than the specified timestamp
      this.events.set(
        topic,
        events.filter((e) => e.timestamp >= beforeTimestamp),
      );

      const deletedCount = initialCount - this.events.get(topic)!.length;
      resolve(deletedCount);
    });
  }
}

/**
 * File-based event store implementation that persists events to disk
 * This is a more durable solution than the in-memory store
 */
export class FileEventStore implements EventStore {
  private baseDir: string;
  private topicDirs: Map<string, string> = new Map();

  constructor(baseDir: string = "./event_store") {
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

  private async ensureTopicDir(topic: string): Promise<string> {
    if (this.topicDirs.has(topic)) {
      return this.topicDirs.get(topic)!;
    }

    const topicDir = `${this.baseDir}/${topic}`;
    try {
      await Deno.stat(topicDir);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        await Deno.mkdir(topicDir, { recursive: true });
      } else {
        throw error;
      }
    }

    this.topicDirs.set(topic, topicDir);
    return topicDir;
  }

  async saveEvent(event: Event): Promise<void> {
    const topicDir = await this.ensureTopicDir(event.topic);
    const filename = `${topicDir}/${event.timestamp}_${event.id}.json`;
    await Deno.writeTextFile(filename, JSON.stringify(event));
  }

  async getEvents(
    topic: string,
    options: {
      fromTimestamp?: number;
      toTimestamp?: number;
      limit?: number;
      eventTypes?: string[];
    } = {},
  ): Promise<Event[]> {
    try {
      const topicDir = await this.ensureTopicDir(topic);
      const files = [];

      // Read all event files in the topic directory
      for await (const dirEntry of Deno.readDir(topicDir)) {
        if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
          files.push(dirEntry.name);
        }
      }

      // Sort files by timestamp (which is part of the filename)
      files.sort();

      const events: Event[] = [];
      for (const file of files) {
        const filePath = `${topicDir}/${file}`;
        const content = await Deno.readTextFile(filePath);
        const event = JSON.parse(content) as Event;

        // Apply filters
        if (options.fromTimestamp && event.timestamp < options.fromTimestamp) {
          continue;
        }

        if (options.toTimestamp && event.timestamp > options.toTimestamp) {
          continue;
        }

        if (
          options.eventTypes?.length &&
          !options.eventTypes.includes(event.type)
        ) {
          continue;
        }

        events.push(event);

        // Respect the limit if provided
        if (options.limit && events.length >= options.limit) {
          break;
        }
      }

      return events;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }
      throw error;
    }
  }

  async deleteEvents(topic: string, beforeTimestamp: number): Promise<number> {
    try {
      const topicDir = await this.ensureTopicDir(topic);
      let deletedCount = 0;

      for await (const dirEntry of Deno.readDir(topicDir)) {
        if (dirEntry.isFile && dirEntry.name.endsWith(".json")) {
          // Extract timestamp from filename
          const timestamp = parseInt(dirEntry.name.split("_")[0], 10);

          if (timestamp < beforeTimestamp) {
            await Deno.remove(`${topicDir}/${dirEntry.name}`);
            deletedCount++;
          }
        }
      }

      return deletedCount;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return 0;
      }
      throw error;
    }
  }
}

/**
 * PostgreSQL-based event store implementation for production use
 * Provides scalable, durable storage with robust querying capabilities
 */
export class PostgresEventStore implements EventStore {
  private pool: Pool;
  private isInitialized: boolean = false;
  private readonly options: Required<PostgresEventStoreOptions>;

  /**
   * Create a new PostgreSQL event store
   * @param connectionString - Connection string for the PostgreSQL database
   */
  constructor(connectionString: string, options: PostgresEventStoreOptions = {
    tableName: "events",
    idType: "uuid",
  }) {
    this.pool = new Pool(connectionString, 10, true);
    this.options = options as Required<PostgresEventStoreOptions>;
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
      // Create the events table if it doesn't exist
      await client.queryObject(`
        CREATE TABLE IF NOT EXISTS ${this.options.tableName} (
          id ${this.options.idType.toUpperCase()} PRIMARY KEY,
          topic TEXT NOT NULL,
          type TEXT NOT NULL,
          timestamp BIGINT NOT NULL,
          schema_version TEXT NOT NULL,
          payload JSONB NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create indexes for efficient querying
      const prefix = this.options.tableName.toLocaleLowerCase();
      await client.queryObject(`
        CREATE INDEX IF NOT EXISTS ${prefix}_topic_idx ON ${this.options.tableName} (topic);
        CREATE INDEX IF NOT EXISTS ${prefix}_timestamp_idx ON ${this.options.tableName} (timestamp);
        CREATE INDEX IF NOT EXISTS ${prefix}_type_idx ON ${this.options.tableName} (type);
        CREATE INDEX IF NOT EXISTS ${prefix}_topic_timestamp_idx ON ${this.options.tableName} (topic, timestamp);
      `);

      this.isInitialized = true;
    } finally {
      client.release();
    }
  }

  /**
   * Save an event to PostgreSQL
   */
  async saveEvent(event: Event): Promise<void> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      await client.queryObject(
        `
        INSERT INTO ${this.options.tableName} (id, topic, type, timestamp, schema_version, payload, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
        [
          event.id,
          event.topic,
          event.type,
          event.timestamp,
          event.schemaVersion,
          JSON.stringify(event.payload),
          JSON.stringify(event.metadata),
        ],
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get events for a topic with optional filtering
   */
  async getEvents(
    topic: string,
    options?: {
      fromTimestamp?: number;
      toTimestamp?: number;
      limit?: number;
      eventTypes?: string[];
    },
  ): Promise<Event[]> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      // Build the query with parameters
      let queryText = `
        SELECT id, topic, type, timestamp, schema_version, payload, metadata
        FROM ${this.options.tableName}
        WHERE topic = $1
      `;

      const queryParams: unknown[] = [topic];
      let paramIndex = 2;

      // Add timestamp filters if specified
      if (options?.fromTimestamp) {
        queryText += ` AND timestamp >= $${paramIndex}`;
        queryParams.push(options.fromTimestamp);
        paramIndex++;
      }

      if (options?.toTimestamp) {
        queryText += ` AND timestamp <= $${paramIndex}`;
        queryParams.push(options.toTimestamp);
        paramIndex++;
      }

      // Add event type filters if specified
      if (options?.eventTypes?.length) {
        queryText += ` AND type = ANY($${paramIndex}::text[])`;
        queryParams.push(options.eventTypes);
        paramIndex++;
      }

      // Order by timestamp
      queryText += ` ORDER BY timestamp ASC`;

      // Add limit if specified
      if (options?.limit) {
        queryText += ` LIMIT $${paramIndex}`;
        queryParams.push(options.limit);
      }

      const result = await client.queryObject<{
        id: string;
        topic: string;
        type: string;
        timestamp: number;
        schema_version: string;
        payload: string;
        metadata: string | null;
      }>(queryText, queryParams);

      // Convert rows to Event objects
      return result.rows.map((row) => ({
        id: row.id,
        topic: row.topic,
        type: row.type,
        timestamp: row.timestamp,
        schemaVersion: row.schema_version,
        payload: JSON.parse(row.payload),
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      }));
    } finally {
      client.release();
    }
  }

  /**
   * Delete events before a specific timestamp
   */
  async deleteEvents(topic: string, beforeTimestamp: number): Promise<number> {
    await this.initialize();

    const client = await this.pool.connect();
    try {
      const result = await client.queryObject(
        `
        DELETE FROM ${this.options.tableName}
        WHERE topic = $1 AND timestamp < $2
        RETURNING COUNT(*);
      `,
        [topic, beforeTimestamp],
      );

      return result.rowCount || 0;
    } finally {
      client.release();
    }
  }

  /**
   * Close the connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
