# env-event-stream

A high-performance, feature-rich event stream library for Deno that serves as the backbone for
event-driven architectures.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![deno compatibility](https://shield.deno.dev/deno/^1.34)](https://deno.land/x/env_event_stream)
[![JSR module](https://jsr.io/badges/@env/env-event-stream)](https://jsr.io/@env/env-event-stream)

## Overview

The `env-event-stream` library provides a robust foundation for building event-driven applications
with Deno. Whether you're implementing a distributed system, microservices architecture, or just
need a reliable way to handle application events, this library offers the tools you need.

### Core Features

- **High-performance publish/subscribe system**: Topic-based event distribution with efficient event
  routing
- **Event persistence and replay**: Store events in memory, files, or databases and replay them when
  needed
- **Schema validation**: Enforce event format consistency with JSON Schema validation
- **Dead letter queue**: Robust handling of failed event processing with retry mechanisms
- **Event sourcing support**: Tools for building event-sourced applications with aggregates and
  repositories
- **Flexible storage options**: Pluggable storage backends with built-in support for in-memory,
  file-based, and extensible for databases

## Installation

### From JSR (JavaScript Registry)

```typescript
// Import from JSR registry
import { EventBroker } from "@env/env-event-stream";
```

## Quick Start

```typescript
import { defaultBroker } from "@env/env-event-stream";

// Define event payload type
interface UserCreatedEvent {
  userId: string;
  username: string;
  email: string;
}

// Subscribe to events
defaultBroker.subscribe<UserCreatedEvent>("users", async (event) => {
  console.log(`User created: ${event.payload.username}`);
});

// Publish an event
await defaultBroker.publish<UserCreatedEvent>("users", "user.created", {
  userId: "user-123",
  username: "johndoe",
  email: "john@example.com",
});
```

## Architecture

The library is designed around several key components:

![Architecture Diagram](https://raw.githubusercontent.com/elastic-networth-visualizer/env-event-stream/main/architecture.svg)

- **EventBroker**: Central hub for coordinating event flow
- **Topic**: Channel for specific event categories
- **Subscription**: Connection between event publishers and consumers
- **EventStore**: Storage mechanism for events
- **DeadLetterQueue**: Storage for failed event processing
- **SchemaRegistry**: Validation system for event formats

These components can be configured and extended to match your specific requirements.

## Core Concepts

### Broker

The `EventBroker` is the central hub that manages topics and facilitates event distribution.

```typescript
// Create a new broker instance
const broker = new EventBroker();

// Or use the default shared instance
import { defaultBroker } from "https://deno.land/x/env_event_stream/mod.ts";
```

### Topics

Topics are channels to which events are published and from which subscribers receive events.

```typescript
// Create a topic
const userTopic = broker.createTopic("users", {
  persistent: true,
  retentionPeriod: 86400000, // 24 hours in milliseconds
  maxEvents: 10000,
});
```

### Subscriptions

Subscriptions define how and where events are delivered.

```typescript
// Subscribe to a topic
const subscription = broker.subscribe(
  "users",
  async (event) => {
    // Handle the event
    console.log(event.payload);
  },
  {
    name: "user-logger",
    eventTypes: ["user.created", "user.updated"],
    maxRetries: 3,
    retryDelay: 1000,
  },
);

// Subscription management
subscription.pause(); // Temporarily stop receiving events
subscription.resume(); // Resume receiving events
```

### Event Schema Validation

Ensure events conform to expected schemas.

```typescript
import { JsonSchemaRegistry } from "https://deno.land/x/env_event_stream/mod.ts";

// Create a schema registry
const schemaRegistry = new JsonSchemaRegistry();

// Register a schema for an event type
schemaRegistry.registerSchema(
  "user.created",
  {
    type: "object",
    required: ["userId", "username", "email"],
    properties: {
      userId: { type: "string" },
      username: { type: "string" },
      email: { type: "string" },
    },
  },
  "1.0",
);

// Create a topic with schema validation
const userTopic = broker.createTopic("users", {
  schemaRegistry,
});
```

### Event Persistence

Store events for later replay and analysis.

```typescript
import { FileEventStore } from "https://deno.land/x/env_event_stream/mod.ts";

// Create a file-based event store
const eventStore = new FileEventStore("./event_store");

// Replay events from a topic
const events = await eventStore.getEvents("users", {
  fromTimestamp: Date.now() - 86400000, // Last 24 hours
  eventTypes: ["user.created"],
});

// Process the events
for (const event of events) {
  console.log(event.payload);
}
```

### Dead Letter Queue

Handle failed event processing with robust retry mechanisms.

```typescript
import { FileDeadLetterQueue } from "https://deno.land/x/env_event_stream/mod.ts";

// Create a file-based dead letter queue
const deadLetterQueue = new FileDeadLetterQueue("./dead_letter_queue");

// Get failed events
const failedEvents = await deadLetterQueue.getEvents({
  topic: "users",
  limit: 10,
});

// Retry a failed event
for (const entry of failedEvents) {
  await deadLetterQueue.retryEvent(entry.event.id);
}
```

### Event Sourcing

Build event-sourced applications with aggregates and repositories.

```typescript
import { AggregateRoot, EventSourcedRepository } from "https://deno.land/x/env_event_stream/mod.ts";

// Define a user aggregate
class User extends AggregateRoot<{ username: string; email: string }> {
  constructor(id: string) {
    super(id, { username: "", email: "" });
  }

  createUser(username: string, email: string): void {
    this.recordEvent("user.created", { username, email });
  }

  updateEmail(email: string): void {
    this.recordEvent("user.email.updated", { email });
  }

  protected applyEvent(event: Event): void {
    if (event.type === "user.created") {
      this.state.username = event.payload.username;
      this.state.email = event.payload.email;
    } else if (event.type === "user.email.updated") {
      this.state.email = event.payload.email;
    }
  }
}

// Create a repository for users
const userRepository = new EventSourcedRepository<User>((id) => new User(id));

// Create a new user
const user = new User("user-123");
user.createUser("johndoe", "john@example.com");

// Save the user
await userRepository.save(user);

// Load the user later
const loadedUser = await userRepository.getById("user-123");
console.log(loadedUser?.getState());
```

## Database Integration

The library is designed to work with various storage backends through its `EventStore` and
`DeadLetterQueue` interfaces. While in-memory and file-based implementations are provided out of the
box, you can create your own database implementations:

### Creating a Database-Backed Event Store

```typescript
import { Event, EventStore } from "https://deno.land/x/env_event_stream/mod.ts";

class PostgresEventStore implements EventStore {
  private client: PostgresClient;

  constructor(connectionString: string) {
    this.client = new PostgresClient(connectionString);
  }

  async saveEvent(event: Event): Promise<void> {
    await this.client.query(
      `INSERT INTO events (id, type, topic, timestamp, schema_version, payload, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        event.id,
        event.type,
        event.topic,
        event.timestamp,
        event.schemaVersion,
        JSON.stringify(event.payload),
        JSON.stringify(event.metadata),
      ],
    );
  }

  async getEvents(topic: string, options = {}): Promise<Event[]> {
    // Build query dynamically based on options
    let query = `SELECT * FROM events WHERE topic = $1`;
    const params: unknown[] = [topic];

    if (options.fromTimestamp) {
      query += ` AND timestamp >= $${params.length + 1}`;
      params.push(options.fromTimestamp);
    }

    if (options.toTimestamp) {
      query += ` AND timestamp <= $${params.length + 1}`;
      params.push(options.toTimestamp);
    }

    if (options.eventTypes?.length) {
      query += ` AND type = ANY($${params.length + 1})`;
      params.push(options.eventTypes);
    }

    query += ` ORDER BY timestamp ASC`;

    if (options.limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(options.limit);
    }

    const result = await this.client.query(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      topic: row.topic,
      timestamp: row.timestamp,
      schemaVersion: row.schema_version,
      payload: JSON.parse(row.payload),
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    }));
  }

  async deleteEvents(topic: string, beforeTimestamp: number): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM events WHERE topic = $1 AND timestamp < $2 RETURNING id`,
      [topic, beforeTimestamp],
    );

    return result.rowCount;
  }
}
```

### Creating a Database-Backed Dead Letter Queue

```typescript
import {
  DeadLetterEntry,
  DeadLetterQueue,
  Event,
} from "https://deno.land/x/env_event_stream/mod.ts";

class MongoDeadLetterQueue implements DeadLetterQueue {
  private collection: MongoCollection;

  constructor(connectionString: string) {
    const client = new MongoClient(connectionString);
    this.collection = client.database("events").collection("dead_letter_queue");
  }

  async addEvent(
    event: Event,
    error: Error,
    subscriptionName: string,
  ): Promise<void> {
    await this.collection.insertOne({
      eventId: event.id,
      event: event,
      error: error.message,
      stack: error.stack,
      subscription: subscriptionName,
      timestamp: Date.now(),
      attempts: 1,
    });
  }

  async getEvents(options = {}): Promise<DeadLetterEntry[]> {
    const query: Record<string, unknown> = {};

    if (options.topic) {
      query["event.topic"] = options.topic;
    }

    if (options.eventType) {
      query["event.type"] = options.eventType;
    }

    const entries = await this.collection
      .find(query)
      .sort({ timestamp: -1 })
      .limit(options.limit || 0)
      .toArray();

    return entries.map((entry) => ({
      event: entry.event,
      error: entry.error,
      subscription: entry.subscription,
      timestamp: entry.timestamp,
      attempts: entry.attempts,
    }));
  }

  async retryEvent(eventId: string): Promise<boolean> {
    const result = await this.collection.updateOne(
      { eventId: eventId },
      { $inc: { attempts: 1 } },
    );

    return result.modifiedCount > 0;
  }

  async removeEvent(eventId: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ eventId: eventId });
    return result.deletedCount > 0;
  }
}
```

## Performance Optimization

### High Throughput Settings

For systems processing large volumes of events:

```typescript
const broker = new EventBroker();

// Use in-memory store for high throughput
const inMemoryStore = broker.getEventStore();

// Configure topics for performance
const highThroughputTopic = broker.createTopic("metrics", {
  persistent: false, // Don't persist every event
  maxEvents: 0, // No limit in memory
});

// Batch processing
let batch: Event[] = [];
const BATCH_SIZE = 1000;

// Subscribe with batch processing
highThroughputTopic.subscribe(async (event) => {
  batch.push(event);

  if (batch.length >= BATCH_SIZE) {
    await processBatchInParallel(batch);
    batch = [];
  }
});

// Periodically process remaining batch items
setInterval(async () => {
  if (batch.length > 0) {
    await processBatchInParallel(batch);
    batch = [];
  }
}, 5000);
```

### Distributed System Configuration

For distributed environments:

```typescript
// Create a database-backed event store
const pgEventStore = new PostgresEventStore(
  "postgres://user:pass@localhost/events",
);

// Create a broker that uses this store
const broker = new EventBroker({ eventStore: pgEventStore });

// Periodic checkpoint for event sourcing
const checkpointInterval = 100;
let eventCount = 0;

broker.subscribe("orders", async (event) => {
  // Process event
  await processOrder(event);

  eventCount++;

  // Create a snapshot periodically
  if (eventCount % checkpointInterval === 0) {
    await createOrderSystemSnapshot();
  }
});
```

## Testing

The library includes testing utilities to make your event-driven applications easier to test:

```typescript
import { TestBroker } from "https://deno.land/x/env_event_stream/testing.ts";

Deno.test("Order Processing", async () => {
  // Create a test broker
  const testBroker = new TestBroker();

  // Replace production broker with test one
  const orderService = new OrderService(testBroker);

  // Publish test event
  await testBroker.publish("orders", "order.created", {
    orderId: "test-123",
    items: [{ productId: "p1", quantity: 2 }],
  });

  // Wait for processing
  await testBroker.waitForProcessing();

  // Verify expected events were published
  const publishedEvents = testBroker.getPublishedEvents("inventory");
  assertEquals(publishedEvents.length, 1);
  assertEquals(publishedEvents[0].type, "inventory.reserved");
});
```

## Best Practices

### Event Schema Evolution

As your system evolves, you may need to change event schemas. Here's how to handle it:

1. **Always version your schemas**:

   ```typescript
   schemaRegistry.registerSchema("user.created", userSchemaV1, "1.0");
   schemaRegistry.registerSchema("user.created", userSchemaV2, "2.0");
   ```

2. **Support backward compatibility**:

   ```typescript
   // Event consumer supporting multiple versions
   broker.subscribe("users", (event) => {
     if (event.schemaVersion === "1.0") {
       // Handle v1 format
       processUserV1(event.payload);
     } else {
       // Handle v2+ format
       processUserV2(event.payload);
     }
   });
   ```

3. **Migrate old events when needed**:

   ```typescript
   // Migration utility
   async function migrateEvents() {
     const oldEvents = await eventStore.getEvents("users", {
       eventTypes: ["user.created"],
       toTimestamp: cutoffDate,
     });

     for (const oldEvent of oldEvents) {
       if (oldEvent.schemaVersion === "1.0") {
         const newPayload = convertV1ToV2(oldEvent.payload);
         await broker.publish("users", "user.created", newPayload, {
           schemaVersion: "2.0",
           originalEventId: oldEvent.id,
         });
       }
     }
   }
   ```

### Error Handling Strategies

Implement robust error handling:

```typescript
broker.subscribe(
  "orders",
  async (event) => {
    try {
      // Attempt processing
      await processOrder(event.payload);
    } catch (error) {
      if (isTransientError(error)) {
        // Retry later - will use the built-in retry mechanism
        throw error;
      } else {
        // Permanent failure - log and record, but don't retry
        await broker.publish("orders", "order.processingFailed", {
          orderId: event.payload.orderId,
          error: error.message,
        });

        // Don't rethrow, so the event won't go to DLQ
      }
    }
  },
  {
    maxRetries: 5,
    retryDelay: 1000 * Math.pow(2, attempt), // Exponential backoff
  },
);
```

## Production Deployment Considerations

When deploying to production:

1. **Use persistent storage**: Implement a database-backed `EventStore` and `DeadLetterQueue`
2. **Monitor queue sizes**: Track event processing latency and queue depths
3. **Implement circuit breakers**: Protect downstream systems from cascading failures
4. **Set up alerts**: Monitor dead letter queue size and processing failures
5. **Create operational dashboards**: Visualize event flow through your system

## License

MIT © Elastic Networth Visualizer
