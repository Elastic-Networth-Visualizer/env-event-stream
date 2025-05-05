/**
 * Basic event interface that all events should implement
 */
export interface Event<T = unknown> {
  /**
   * Unique identifier for the event
   */
  id: string;

  /**
   * Event type/name used for routing
   */
  type: string;

  /**
   * Topic this event belongs to
   */
  topic: string;

  /**
   * Timestamp when the event was created
   */
  timestamp: number;

  /**
   * Version of the event schema
   */
  schemaVersion: string;

  /**
   * Actual event payload data
   */
  payload: T;

  /**
   * Optional metadata for the event
   */
  metadata?: Record<string, unknown>;
}

/**
 * Function signature for event handlers
 */
export type EventHandler<T = unknown> = (
  event: Event<T>,
) => Promise<void> | void;

/**
 * Options for subscribing to a topic
 */
export interface SubscriptionOptions {
  /**
   * Optional name for this subscription
   */
  name?: string;

  /**
   * Filter to only receive specific event types
   */
  eventTypes?: string[];

  /**
   * Should this subscription receive events that were published before it subscribed?
   */
  receiveHistoricalEvents?: boolean;

  /**
   * Maximum number of times to retry delivery if handler fails
   */
  maxRetries?: number;

  /**
   * Time in milliseconds to wait between retries
   */
  retryDelay?: number;
}

/**
 * Options for creating a topic
 */
export interface TopicOptions {
  /**
   * Should the topic persist events
   */
  persistent?: boolean;

  /**
   * Time in milliseconds to retain events (0 = forever)
   */
  retentionPeriod?: number;

  /**
   * Maximum number of events to retain (0 = unlimited)
   */
  maxEvents?: number;

  /**
   * Schema registry for validating events on this topic
   */
  schemaRegistry?: SchemaRegistry;
}

/**
 * Interface for schema validation
 */
export interface SchemaRegistry {
  /**
   * Register a schema for an event type
   */
  registerSchema(eventType: string, schema: unknown, version: string): void;

  /**
   * Validate an event against its registered schema
   */
  validate(event: Event): boolean | Promise<boolean>;

  /**
   * Get all registered schemas
   */
  getSchemas(): Record<string, unknown>;
}

/**
 * Result of publishing an event
 */
export interface PublishResult {
  /**
   * Whether the event was successfully published
   */
  success: boolean;

  /**
   * Event ID that was published
   */
  eventId: string;

  /**
   * Number of subscribers that received the event
   */
  receiverCount: number;

  /**
   * Any error that occurred during publishing
   */
  error?: Error | unknown;
}

/**
 * Dead letter queue entry containing details about failed events
 */
export interface DeadLetterEntry {
  /**
   * The event that failed processing
   */
  event: Event;

  /**
   * Error message or reason for failure
   */
  error: string;

  /**
   * The subscription that was processing the event
   */
  subscription: string;

  /**
   * When the event was added to the dead letter queue
   */
  timestamp: number;

  /**
   * Number of processing attempts
   */
  attempts: number;
}

/**
 * Interface for event persistence
 */
export interface EventStore {
  /**
   * Save an event to persistence
   */
  saveEvent(event: Event): Promise<void>;

  /**
   * Get events for a specific topic
   */
  getEvents(
    topic: string,
    options?: {
      fromTimestamp?: number;
      toTimestamp?: number;
      limit?: number;
      eventTypes?: string[];
    },
  ): Promise<Event[]>;

  /**
   * Delete events (e.g., for retention policies)
   */
  deleteEvents(topic: string, beforeTimestamp: number): Promise<number>;
}

/**
 * Interface for the postgres event store options
 */
export interface PostgresEventStoreOptions {
  /**
   * The table name to use for storing events
   */
  tableName?: string;

  /**
   * What type of id to use for the event
   */
  idType?: 'uuid' | 'serial' | 'bigint';
}

/**
 * Interface for the dead letter queue
 */
export interface DeadLetterQueue {
  /**
   * Add a failed event to the dead letter queue
   */
  addEvent(event: Event, error: Error, subscriptionName: string): Promise<void>;

  /**
   * Get failed events from the queue
   */
  getEvents(options?: {
    topic?: string;
    eventType?: string;
    limit?: number;
  }): Promise<DeadLetterEntry[]>;

  /**
   * Retry processing a failed event
   */
  retryEvent(eventId: string): Promise<boolean>;

  /**
   * Remove an event from the dead letter queue
   */
  removeEvent(eventId: string): Promise<boolean>;
}

/**
 * Interface for the postgres dead letter queue options
 */
export interface PostgresDeadLetterQueueOptions extends PostgresEventStoreOptions {}
