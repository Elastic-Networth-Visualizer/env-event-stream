import { Event, EventStore } from "./types.ts";
import { generateId } from "./utils.ts";

/**
 * Base class for event-sourced entities
 * Event sourcing is a pattern where state changes are captured as a sequence of events
 */
export abstract class EventSourcedEntity<State> {
  protected state: State;
  private eventHistory: Event[] = [];
  private version: number = 0;

  constructor(initialState: State) {
    this.state = { ...initialState };
  }

  /**
   * Get the current state of the entity
   */
  getState(): Readonly<State> {
    return { ...this.state };
  }

  /**
   * Get the current version of the entity
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Get all events that have been applied to this entity
   */
  getEvents(): ReadonlyArray<Event> {
    return [...this.eventHistory];
  }

  /**
   * Apply an event to update the entity's state
   */
  apply(event: Event): void {
    // Apply the event to update the state
    this.applyEvent(event);

    // Add to history and increment version
    this.eventHistory.push({ ...event });
    this.version++;
  }

  /**
   * Rehydrate the entity state from a sequence of events
   */
  rehydrate(events: Event[]): void {
    // Reset to initial state
    this.eventHistory = [];
    this.version = 0;

    // Apply all events in sequence
    for (const event of events) {
      this.apply(event);
    }
  }

  /**
   * Must be implemented by derived classes to handle state updates for specific events
   */
  protected abstract applyEvent(event: Event): void;
}

/**
 * Aggregate root representing a collection of entities managed through event sourcing
 */
export abstract class AggregateRoot<State> extends EventSourcedEntity<State> {
  private id: string;
  private uncommittedEvents: Event[] = [];

  constructor(id: string, initialState: State) {
    super(initialState);
    this.id = id;
  }

  /**
   * Get the ID of this aggregate
   */
  getId(): string {
    return this.id;
  }

  /**
   * Record a new event without immediately applying it
   */
  protected recordEvent<T = unknown>(
    eventType: string,
    payload: T,
    metadata: Record<string, unknown> = {},
  ): void {
    const event: Event<T> = {
      id: generateId(),
      type: eventType,
      topic: `aggregate.${this.id}`,
      timestamp: Date.now(),
      schemaVersion: "1.0",
      payload,
      metadata: {
        aggregateId: this.id,
        aggregateVersion: this.getVersion(),
        ...metadata,
      },
    };

    // Apply the event to update the state
    this.apply(event);

    // Add to uncommitted events
    this.uncommittedEvents.push(event);
  }

  /**
   * Get events that have been recorded but not yet committed
   */
  getUncommittedEvents(): ReadonlyArray<Event> {
    return [...this.uncommittedEvents];
  }

  /**
   * Mark all uncommitted events as committed
   */
  markEventsAsCommitted(): void {
    this.uncommittedEvents = [];
  }
}

/**
 * Repository for managing event-sourced aggregates
 * This class uses the EventStore interface for persistence
 */
export class EventSourcedRepository<T extends AggregateRoot<unknown>> {
  private eventStore: EventStore;
  private aggregateFactory: (id: string) => T;
  private aggregateType: string;

  /**
   * Create a new repository for a specific aggregate type
   * 
   * @param aggregateFactory - Function to create a new instance of the aggregate
   * @param eventStore - Event store implementation
   * @param aggregateType - Type name for this aggregate (used for topic naming)
   */
  constructor(
    aggregateFactory: (id: string) => T, 
    eventStore: EventStore,
    aggregateType: string
  ) {
    this.aggregateFactory = aggregateFactory;
    this.eventStore = eventStore;
    this.aggregateType = aggregateType;
  }

  /**
   * Save an aggregate and its uncommitted events
   * 
   * @param aggregate - The aggregate to save
   * @throws Error if there's a problem saving events
   */
  async save(aggregate: T): Promise<void> {
    const uncommittedEvents = aggregate.getUncommittedEvents();

    if (uncommittedEvents.length === 0) {
      return;
    }

    try {
      // Save each event to the event store
      for (const event of uncommittedEvents) {
        await this.eventStore.saveEvent(event);
      }
      
      // Mark events as committed
      aggregate.markEventsAsCommitted();
    } catch (error) {
      throw new Error(`Failed to save aggregate ${aggregate.getId()}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get an aggregate by ID, rehydrating it from its event stream
   * 
   * @param id - The aggregate ID
   * @returns The rehydrated aggregate or null if not found
   */
  async getById(id: string): Promise<T | null> {
    try {
      // Get all events for this aggregate
      const topicName = this.getTopicName(id);
      const events = await this.eventStore.getEvents(topicName);

      if (events.length === 0) {
        return null;
      }

      // Create a new aggregate
      const aggregate = this.aggregateFactory(id);

      // Rehydrate from stored events
      aggregate.rehydrate(events);

      return aggregate;
    } catch (error) {
      throw new Error(`Failed to load aggregate ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if an aggregate with the given ID exists
   * 
   * @param id - The aggregate ID
   * @returns True if the aggregate exists
   */
  async exists(id: string): Promise<boolean> {
    const topicName = this.getTopicName(id);
    const events = await this.eventStore.getEvents(topicName, { limit: 1 });
    return events.length > 0;
  }

  /**
   * Get events for an aggregate with optional filtering
   * 
   * @param id - The aggregate ID
   * @param options - Filter options
   * @returns Array of events
   */
  async getEvents(
    id: string,
    options: {
      fromTimestamp?: number;
      toTimestamp?: number;
      limit?: number;
      eventTypes?: string[];
    } = {}
  ): Promise<Event[]> {
    const topicName = this.getTopicName(id);
    return await this.eventStore.getEvents(topicName, options);
  }

  /**
   * Delete events for an aggregate before a specific timestamp
   * Useful for implementing retention policies
   * 
   * @param id - The aggregate ID
   * @param beforeTimestamp - Delete events before this timestamp
   * @returns Number of events deleted
   */
  async deleteEvents(id: string, beforeTimestamp: number): Promise<number> {
    const topicName = this.getTopicName(id);
    return await this.eventStore.deleteEvents(topicName, beforeTimestamp);
  }

  /**
   * Generate the topic name for an aggregate
   * 
   * @param id - The aggregate ID
   * @returns The topic name
   */
  private getTopicName(id: string): string {
    return `aggregate.${this.aggregateType}.${id}`;
  }
}

/**
 * A factory to create repositories for different aggregate types
 * Helps to maintain consistent repository configuration
 */
export class RepositoryFactory {
  private eventStore: EventStore;
  
  constructor(eventStore: EventStore) {
    this.eventStore = eventStore;
  }
  
  /**
   * Create a repository for a specific aggregate type
   * 
   * @param aggregateFactory - Function to create a new instance of the aggregate
   * @param aggregateType - Type name for this aggregate
   * @returns A new repository instance
   */
  createRepository<T extends AggregateRoot<unknown>>(
    aggregateFactory: (id: string) => T,
    aggregateType: string
  ): EventSourcedRepository<T> {
    return new EventSourcedRepository<T>(
      aggregateFactory,
      this.eventStore,
      aggregateType
    );
  }
}