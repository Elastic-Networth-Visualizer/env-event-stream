import { DeadLetterEntry, DeadLetterQueue, Event } from "./types.ts";

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
