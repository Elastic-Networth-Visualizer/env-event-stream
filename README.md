# env-event-stream

A high-performance, feature-rich event stream library for Deno that serves as the backbone for event-driven architectures.

## Overview

The `env-event-stream` library is a core component of the Elastic Networth Visualizer (ENV) project, but designed as a standalone solution that can be used in any Deno application requiring robust event-based communication.

### Core Features

- **Topic-based publish/subscribe system**: Organize events by topic and subscribe to receive events from specific topics
- **Event persistence and replay capability**: Store events for later replay and analysis
- **Event schema validation and versioning**: Ensure events conform to expected schemas
- **Dead letter queuing and error handling**: Robust handling of failed event processing
- **Event sourcing support**: Build event-sourced applications with aggregates and repositories

## Installation

```typescript
// Import directly from Deno registry
import { EventBroker } from "https://deno.land/x/env_event_stream/mod.ts";
```

## Quick Start

```typescript
import { defaultBroker } from "https://deno.land/x/env_event_stream/mod.ts";

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
  email: "john@example.com"
});
```

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
  maxEvents: 10000
});
```

### Subscriptions

Subscriptions define how and where events are delivered.

```typescript
// Subscribe to a topic
const subscription = broker.subscribe("users", async (event) => {
  // Handle the event
  console.log(event.payload);
}, {
  name: "user-logger",
  eventTypes: ["user.created", "user.updated"],
  maxRetries: 3,
  retryDelay: 1000
});

// Pause a subscription
subscription.pause();

// Resume a subscription
subscription.resume();
```

### Event Schema Validation

Ensure events conform to expected schemas.

```typescript
import { JsonSchemaRegistry } from "https://deno.land/x/env_event_stream/mod.ts";

// Create a schema registry
const schemaRegistry = new JsonSchemaRegistry();

// Register a schema for an event type
schemaRegistry.registerSchema("user.created", {
  type: "object",
  required: ["userId", "username", "email"],
  properties: {
    userId: { type: "string" },
    username: { type: "string" },
    email: { type: "string" }
  }
}, "1.0");

// Create a topic with schema validation
const userTopic = broker.createTopic("users", {
  schemaRegistry
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
  eventTypes: ["user.created"]
});

// Process the events
for (const event of events) {
  console.log(event.payload);
}
```

### Dead Letter Queue

Handle failed event processing.

```typescript
import { FileDeadLetterQueue } from "https://deno.land/x/env_event_stream/mod.ts";

// Create a file-based dead letter queue
const deadLetterQueue = new FileDeadLetterQueue("./dead_letter_queue");

// Get failed events
const failedEvents = await deadLetterQueue.getEvents({
  topic: "users",
  limit: 10
});

// Retry a failed event
for (const entry of failedEvents) {
  await deadLetterQueue.retryEvent(entry.event.id);
}
```

### Event Sourcing

Build event-sourced applications.

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

## Advanced Usage

### Custom Event Stores

Implement your own event storage:

```typescript
import { EventStore, Event } from "https://deno.land/x/env_event_stream/mod.ts";

class PostgresEventStore implements EventStore {
  // Implementation for PostgreSQL
}
```

### Custom Dead Letter Queues

Implement your own dead letter queue handling:

```typescript
import { DeadLetterQueue, Event } from "https://deno.land/x/env_event_stream/mod.ts";

class RedisDeadLetterQueue implements DeadLetterQueue {
  // Implementation for Redis
}
```

## Performance Considerations

- For high-volume event processing, consider using the in-memory event store during processing with periodic flushing to persistent storage
- For large networks of subscribers, consider partitioning topics by domain
- Use appropriate retry strategies based on your application's requirements

## License

MIT
