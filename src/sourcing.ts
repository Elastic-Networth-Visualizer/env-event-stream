// deno-lint-ignore-file require-await
import { Event } from "./types.ts";
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
    this.state = initialState;
  }
  
  /**
   * Get the current state of the entity
   */
  getState(): State {
    return this.state;
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
  getEvents(): Event[] {
    return [...this.eventHistory];
  }
  
  /**
   * Apply an event to update the entity's state
   */
  apply(event: Event): void {
    // Apply the event to update the state
    this.applyEvent(event);
    
    // Add to history and increment version
    this.eventHistory.push(event);
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
    metadata: Record<string, unknown> = {}
  ): void {
    const event: Event<T> = {
      id: generateId(),
      type: eventType,
      topic: `aggregate.${this.id}`,
      timestamp: Date.now(),
      schemaVersion: '1.0',
      payload,
      metadata: {
        aggregateId: this.id,
        aggregateVersion: this.getVersion(),
        ...metadata
      }
    };
    
    // Apply the event to update the state
    this.apply(event);
    
    // Add to uncommitted events
    this.uncommittedEvents.push(event);
  }
  
  /**
   * Get events that have been recorded but not yet committed
   */
  getUncommittedEvents(): Event[] {
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
 */
export class EventSourcedRepository<T extends AggregateRoot<unknown>> {
  private eventStore: Map<string, Event[]> = new Map();
  private aggregateFactory: (id: string) => T;
  
  constructor(aggregateFactory: (id: string) => T) {
    this.aggregateFactory = aggregateFactory;
  }
  
  /**
   * Save an aggregate and its uncommitted events
   */
  async save(aggregate: T): Promise<void> {
    const uncommittedEvents = aggregate.getUncommittedEvents();
    
    if (uncommittedEvents.length === 0) {
      return;
    }
    
    const aggregateId = aggregate.getId();
    
    // Get existing events
    const existingEvents = this.eventStore.get(aggregateId) || [];
    
    // Add new events
    this.eventStore.set(aggregateId, [...existingEvents, ...uncommittedEvents]);
    
    // Mark events as committed
    aggregate.markEventsAsCommitted();
  }
  
  /**
   * Get an aggregate by ID
   */
  async getById(id: string): Promise<T | null> {
    const events = this.eventStore.get(id) || [];
    
    if (events.length === 0) {
      return null;
    }
    
    // Create a new aggregate
    const aggregate = this.aggregateFactory(id);
    
    // Rehydrate from stored events
    aggregate.rehydrate(events);
    
    return aggregate;
  }
}