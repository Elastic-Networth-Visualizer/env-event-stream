import { Event, EventStore } from "./types.ts";

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
  getEvents(topic: string, options: {
    fromTimestamp?: number;
    toTimestamp?: number;
    limit?: number;
    eventTypes?: string[];
  } = {}): Promise<Event[]> {
    return new Promise((resolve) => {
      if (!this.events.has(topic)) {
        resolve([]);
        return;
      }
      
      let events = this.events.get(topic)!;
      
      // Apply timestamp filters
      if (options.fromTimestamp) {
        events = events.filter(e => e.timestamp >= options.fromTimestamp!);
      }
      
      if (options.toTimestamp) {
        events = events.filter(e => e.timestamp <= options.toTimestamp!);
      }
      
      // Filter by event types if specified
      if (options.eventTypes?.length) {
        events = events.filter(e => options.eventTypes!.includes(e.type));
      }
      
      // Sort by timestamp (oldest first)
      events = events.sort((a, b) => a.timestamp - b.timestamp);
      
      // Apply limit if specified
      if (options.limit) {
        events = events.slice(0, options.limit);
      }

      resolve(events);
    })
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
      this.events.set(topic, events.filter(e => e.timestamp >= beforeTimestamp));
      
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
  
  async getEvents(topic: string, options: {
    fromTimestamp?: number;
    toTimestamp?: number;
    limit?: number;
    eventTypes?: string[];
  } = {}): Promise<Event[]> {
    try {
      const topicDir = await this.ensureTopicDir(topic);
      const files = [];
      
      // Read all event files in the topic directory
      for await (const dirEntry of Deno.readDir(topicDir)) {
        if (dirEntry.isFile && dirEntry.name.endsWith('.json')) {
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
        
        if (options.eventTypes?.length && !options.eventTypes.includes(event.type)) {
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
        if (dirEntry.isFile && dirEntry.name.endsWith('.json')) {
          // Extract timestamp from filename
          const timestamp = parseInt(dirEntry.name.split('_')[0], 10);
          
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