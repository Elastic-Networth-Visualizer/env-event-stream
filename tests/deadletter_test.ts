// deno-lint-ignore-file no-explicit-any require-await
import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { FakeTime } from "@std/testing/time";
import {
  FileDeadLetterQueue,
  PostgresDeadLetterQueue,
  SimpleDeadLetterQueue,
} from "../src/deadletter.ts";
import { DeadLetterEntry, Event } from "../src/types.ts";

// Mock for Deno namespace
const originalDeno = globalThis.Deno;
const mockDeno: Partial<typeof Deno> = {};

// Mock for Pool class
class MockPool {
  private mockClient: any;

  constructor(_connectionString: string = "", _connectionLimit = 10, _connectionTimeoutMs = 30000) {
    this.mockClient = {
      queryObject: (_query: string) => {},
      release: () => {},
    };
  }

  connect() {
    return Promise.resolve(this.mockClient);
  }

  end() {
    return Promise.resolve();
  }

  setMockClient(client: any) {
    this.mockClient = client;
  }
}

// Helper function to create a test event
function createTestEvent(id: string = "test-event-1"): Event {
  return {
    id,
    type: "test-event",
    topic: "test-topic",
    timestamp: Date.now(),
    schemaVersion: "1.0",
    payload: { message: "Hello, World!" },
    metadata: { source: "test" },
  };
}

describe("SimpleDeadLetterQueue", () => {
  let dlq: SimpleDeadLetterQueue;
  let time: FakeTime;

  beforeEach(() => {
    dlq = new SimpleDeadLetterQueue();
    time = new FakeTime();
  });

  afterEach(() => {
    try {
      time.restore();
    } catch (_) {
      // Ignore error indicating time is already restored
    }
  });

  it("should add an event to the queue", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "handler-1");

    const events = await dlq.getEvents();
    assertEquals(events.length, 1);
    assertEquals(events[0].event.id, event.id);
    assertEquals(events[0].error, "Test error");
    assertEquals(events[0].subscription, "handler-1");
    assertEquals(events[0].attempts, 1);
  });

  it("should get events with filtering", async () => {
    const event1 = createTestEvent("test-event-1");
    event1.topic = "topic-1";
    event1.type = "type-1";

    const event2 = createTestEvent("test-event-2");
    event2.topic = "topic-2";
    event2.type = "type-2";

    await dlq.addEvent(event1, new Error("Test error 1"), "handler-1");
    await dlq.addEvent(event2, new Error("Test error 2"), "handler-2");

    // Test filtering by topic
    let events = await dlq.getEvents({ topic: "topic-1" });
    assertEquals(events.length, 1);
    assertEquals(events[0].event.id, event1.id);

    // Test filtering by event type
    events = await dlq.getEvents({ eventType: "type-2" });
    assertEquals(events.length, 1);
    assertEquals(events[0].event.id, event2.id);

    // Test limit
    events = await dlq.getEvents({ limit: 1 });
    assertEquals(events.length, 1);
  });

  it("should retry events successfully", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "handler-1");

    // Mock a successful retry
    const success = await dlq.retryEvent(event.id, (e, s) => {
      assertEquals(e.id, event.id);
      assertEquals(s, "handler-1");
      return Promise.resolve(true);
    });

    assertEquals(success, true);

    // Event should be removed from queue
    const events = await dlq.getEvents();
    assertEquals(events.length, 0);
  });

  it("should handle failed retries", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "handler-1");

    // Mock a failed retry
    const success = await dlq.retryEvent(event.id, () => {
      return Promise.resolve(false);
    });

    assertEquals(success, false);

    // Event should still be in queue with incremented attempts
    const events = await dlq.getEvents();
    assertEquals(events.length, 1);
    assertEquals(events[0].attempts, 2);
  });

  it("should handle retry exceptions", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "handler-1");

    // Mock a retry that throws an error
    const success = await dlq.retryEvent(event.id, () => {
      throw new Error("Retry failed");
    });

    assertEquals(success, false);

    // Event should still be in queue with incremented attempts and error message
    const events = await dlq.getEvents();
    assertEquals(events.length, 1);
    assertEquals(events[0].attempts, 2);
    assertEquals(events[0].error, "Retry failed");
  });

  it("should remove an event from the queue", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "handler-1");

    // Remove the event
    const removed = await dlq.removeEvent(event.id);
    assertEquals(removed, true);

    // Event should no longer be in queue
    const events = await dlq.getEvents();
    assertEquals(events.length, 0);
  });

  it("should return false when removing a non-existent event", async () => {
    const removed = await dlq.removeEvent("non-existent-event");
    assertEquals(removed, false);
  });
});

describe("FileDeadLetterQueue", () => {
  let dlq: FileDeadLetterQueue;
  let time: FakeTime;
  let baseDir: string;
  const mockFs: Record<string, string> = {};

  beforeEach(() => {
    baseDir = "./test_dlq";
    if (time) {
      try {
        time.restore();
      } catch (_) {
        // Ignore error if time was already restored
      }
    }
    time = new FakeTime();

    // Save original Deno object
    Object.assign(mockDeno, {
      mkdir: (path: string) => {
        mockFs[path] = "directory";
        return Promise.resolve();
      },
      writeTextFile: (path: string, content: string) => {
        mockFs[path] = content;
        return Promise.resolve();
      },
      readTextFile: (path: string) => {
        if (!mockFs[path]) {
          throw new Deno.errors.NotFound();
        }
        return Promise.resolve(mockFs[path]);
      },
      remove: (path: string) => {
        if (!mockFs[path]) {
          throw new Deno.errors.NotFound();
        }
        delete mockFs[path];
        return Promise.resolve();
      },
      stat: (path: string) => {
        if (!mockFs[path]) {
          throw new Deno.errors.NotFound();
        }
        return Promise.resolve({
          isFile: mockFs[path] !== "directory",
          isDirectory: mockFs[path] === "directory",
        });
      },
      readDir: async function* (path: string) {
        if (!mockFs[path] || mockFs[path] !== "directory") {
          throw new Deno.errors.NotFound();
        }

        const filesInDir = Object.keys(mockFs)
          .filter((key) => key.startsWith(`${path}/`))
          .map((key) => {
            const name = key.substring(path.length + 1);
            if (name.indexOf("/") === -1) {
              return {
                name,
                isFile: mockFs[key] !== "directory",
                isDirectory: mockFs[key] === "directory",
              };
            }
            return null;
          })
          .filter(Boolean);

        for (const entry of filesInDir) {
          if (entry) {
            yield entry;
          }
        }
      },
      errors: {
        NotFound: class NotFound extends Error {
          constructor() {
            super("File not found");
            this.name = "NotFound";
          }
        },
      },
    });

    // Replace global Deno with mock
    Object.assign(globalThis.Deno, {
      mkdir: mockDeno.mkdir,
      writeTextFile: mockDeno.writeTextFile,
      readTextFile: mockDeno.readTextFile,
      remove: mockDeno.remove,
      stat: mockDeno.stat,
      readDir: mockDeno.readDir,
      errors: mockDeno.errors,
    });
    dlq = new FileDeadLetterQueue(baseDir);
  });

  afterEach(() => {
    try {
      if (time) {
        try {
          time.restore();
        } catch (_) {
          // Ignore error if time was already restored
        }
      }
    } catch (_) {
      // Ignore error indicating time is already restored
    }
    Object.assign(globalThis.Deno, originalDeno); // Safely reassign properties back to original Deno
    Object.keys(mockFs).forEach((key) => delete mockFs[key]);
  });

  it("should create base directory if it doesn't exist", () => {
    assertExists(mockFs[baseDir]);
    assertEquals(mockFs[baseDir], "directory");
  });

  it("should add an event to the queue", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "handler-1");

    // Check that file was created
    const filename = `${baseDir}/${event.id}.json`;
    assertExists(mockFs[filename]);

    // Parse the saved content
    const entry: DeadLetterEntry = JSON.parse(mockFs[filename]);
    assertEquals(entry.event.id, event.id);
    assertEquals(entry.error, "Test error");
    assertEquals(entry.subscription, "handler-1");
    assertEquals(entry.attempts, 1);
  });

  it("should get events with filtering", async () => {
    const event1 = createTestEvent("test-event-1");
    event1.topic = "topic-1";
    event1.type = "type-1";

    const event2 = createTestEvent("test-event-2");
    event2.topic = "topic-2";
    event2.type = "type-2";

    await dlq.addEvent(event1, new Error("Test error 1"), "handler-1");
    await dlq.addEvent(event2, new Error("Test error 2"), "handler-2");

    // Test filtering by topic
    let events = await dlq.getEvents({ topic: "topic-1" });
    assertEquals(events.length, 1);
    assertEquals(events[0].event.id, event1.id);

    // Test filtering by event type
    events = await dlq.getEvents({ eventType: "type-2" });
    assertEquals(events.length, 1);
    assertEquals(events[0].event.id, event2.id);

    // Test limit
    events = await dlq.getEvents({ limit: 1 });
    assertEquals(events.length, 1);
  });

  it("should retry events successfully", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "handler-1");

    // Mock a successful retry
    const success = await dlq.retryEvent(event.id, (e, s) => {
      assertEquals(e.id, event.id);
      assertEquals(s, "handler-1");
      return Promise.resolve(true);
    });

    assertEquals(success, true);

    // Event should be removed from queue
    const events = await dlq.getEvents();
    assertEquals(events.length, 0);

    // Check that the file was deleted
    const filename = `${baseDir}/${event.id}.json`;
    assertEquals(mockFs[filename], undefined);
  });

  it("should handle failed retries", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "handler-1");

    // Mock a failed retry
    const success = await dlq.retryEvent(event.id, () => {
      return Promise.resolve(false);
    });

    assertEquals(success, false);

    // Event should still be in queue with incremented attempts
    const filename = `${baseDir}/${event.id}.json`;
    assertExists(mockFs[filename]);
    const entry: DeadLetterEntry = JSON.parse(mockFs[filename]);
    assertEquals(entry.attempts, 2);
  });

  it("should handle retry exceptions", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "test-subscription");

    // Mock a retry that throws an exception
    const success = await dlq.retryEvent(event.id, () => {
      throw new Error("Retry failed");
    });

    assertEquals(success, false);

    // File should still exist with incremented attempts and updated error
    const filename = `${baseDir}/${event.id}.json`;
    assertExists(mockFs[filename]);
    const entry: DeadLetterEntry = JSON.parse(mockFs[filename]);
    assertEquals(entry.attempts, 2);
    assertEquals(entry.error, "Retry failed");
  });

  it("should remove an event from the queue", async () => {
    const event = createTestEvent();
    await dlq.addEvent(event, new Error("Test error"), "test-subscription");

    const removed = await dlq.removeEvent(event.id);
    assertEquals(removed, true);

    // File should be removed
    const filename = `${baseDir}/${event.id}.json`;
    assertEquals(mockFs[filename], undefined);
  });

  it("should return false when removing non-existent event", async () => {
    const removed = await dlq.removeEvent("non-existent");
    assertEquals(removed, false);
  });
});

describe("PostgresDeadLetterQueue", () => {
  let dlq: PostgresDeadLetterQueue;
  let pool: MockPool;
  let mockClient: any;
  let time: FakeTime;

  beforeEach(() => {
    time = new FakeTime();
    pool = new MockPool();

    // Create mock client with queryObject method
    mockClient = {
      queryObject: async () => ({ rows: [] }),
      release: () => {},
    };

    // Set up the mock client on the pool
    pool.setMockClient(mockClient);

    // Create PostgresDeadLetterQueue with mock pool
    dlq = new PostgresDeadLetterQueue(pool as any);
  });

  afterEach(() => {
    time.restore();
  });

  it("should initialize database schema on first method call", async () => {
    let schemaCreated = false;

    mockClient.queryObject = async (query: string) => {
      if (query.includes("CREATE TABLE IF NOT EXISTS")) {
        schemaCreated = true;
      }
      return { rows: [] };
    };

    // Call any method to trigger initialization
    await dlq.getEvents();

    assertEquals(schemaCreated, true);
  });

  it("should add an event to the queue", async () => {
    const event = createTestEvent();
    let addedEvent = false;

    mockClient.queryObject = async (query: string, params: any[]) => {
      if (query.includes("INSERT INTO")) {
        addedEvent = true;
        assertEquals(params[0], event.id);
        assertEquals(JSON.parse(params[1]).id, event.id);
        assertEquals(params[2], "Test error");
      }
      return { rows: [] };
    };

    await dlq.addEvent(event, new Error("Test error"), "test-subscription");
    assertEquals(addedEvent, true);
  });

  it("should get events with filtering", async () => {
    const mockEntries = [
      {
        event_id: "event-1",
        event_data: JSON.stringify(createTestEvent("event-1")),
        error: "Error 1",
        subscription: "sub-1",
        timestamp: Date.now(),
        attempts: 1,
      },
      {
        event_id: "event-2",
        event_data: JSON.stringify(createTestEvent("event-2")),
        error: "Error 2",
        subscription: "sub-2",
        timestamp: Date.now(),
        attempts: 2,
      },
    ];

    let queryUsed = "";
    let paramsUsed: any[] = [];

    mockClient.queryObject = async (query: string, params: any[] = []) => {
      queryUsed = query;
      paramsUsed = params;
      return { rows: mockEntries };
    };

    // Test with topic filter
    await dlq.getEvents({ topic: "test-topic" });
    assertEquals(queryUsed.includes("event_data->>'topic'"), true);
    assertEquals(paramsUsed[0], "test-topic");

    // Test with event type filter
    await dlq.getEvents({ eventType: "test.event" });
    assertEquals(queryUsed.includes("event_data->>'type'"), true);
    assertEquals(paramsUsed[0], "test.event");

    // Test with limit
    await dlq.getEvents({ limit: 10 });
    assertEquals(queryUsed.includes("LIMIT"), true);
    assertEquals(paramsUsed[0], 10);
  });

  it("should retry events successfully", async () => {
    const event = createTestEvent();
    const mockEntry = {
      event_data: JSON.stringify(event),
      subscription: "test-subscription",
      attempts: 1,
    };

    const queriesExecuted: string[] = [];

    mockClient.queryObject = async (query: string, _params: any[] = []) => {
      queriesExecuted.push(query);

      if (query.includes("SELECT")) {
        return { rows: [mockEntry] };
      }

      if (query.includes("DELETE")) {
        return { rows: [{ event_id: event.id }] };
      }

      return { rows: [] };
    };

    const success = await dlq.retryEvent(event.id, (e, s) => {
      assertEquals(e.id, event.id);
      assertEquals(s, "test-subscription");
      return Promise.resolve(true);
    });

    assertEquals(success, true);
    assertEquals(queriesExecuted.some((q) => q.includes("DELETE")), true);
  });

  it("should handle failed retry attempts", async () => {
    const event = createTestEvent();
    const mockEntry = {
      event_data: JSON.stringify(event),
      subscription: "test-subscription",
      attempts: 1,
    };

    const queriesExecuted: string[] = [];

    mockClient.queryObject = async (query: string) => {
      queriesExecuted.push(query);

      if (query.includes("SELECT")) {
        return { rows: [mockEntry] };
      }

      return { rows: [] };
    };

    const success = await dlq.retryEvent(event.id, () => {
      return Promise.resolve(false);
    });

    assertEquals(success, false);
    assertEquals(queriesExecuted.some((q) => q.includes("UPDATE")), true);
    assertEquals(queriesExecuted.some((q) => q.includes("attempts = attempts + 1")), true);
  });

  it("should handle retry exceptions", async () => {
    const event = createTestEvent();
    const mockEntry = {
      event_data: JSON.stringify(event),
      subscription: "test-subscription",
      attempts: 1,
    };

    const queriesExecuted: string[] = [];
    let errorUpdated = false;

    mockClient.queryObject = async (query: string, params: any[] = []) => {
      queriesExecuted.push(query);

      if (query.includes("SELECT")) {
        return { rows: [mockEntry] };
      }

      if (query.includes("UPDATE") && params[0] === "Retry failed") {
        errorUpdated = true;
      }

      return { rows: [] };
    };

    const success = await dlq.retryEvent(event.id, () => {
      throw new Error("Retry failed");
    });

    assertEquals(success, false);
    assertEquals(queriesExecuted.some((q) => q.includes("UPDATE")), true);
    assertEquals(errorUpdated, true);
  });

  it("should remove an event from the queue", async () => {
    mockClient.queryObject = async (query: string, params: any[]) => {
      if (query.includes("DELETE") && params[0] !== "test-event-1") {
        return { rows: [] };
      }
      return { rows: [{ event_id: "test-event-1" }] };
    };

    const removed = await dlq.removeEvent("test-event-1");
    assertEquals(removed, true);
  });

  it("should return false when removing non-existent event", async () => {
    mockClient.queryObject = async () => {
      return { rows: [] };
    };

    const removed = await dlq.removeEvent("non-existent");
    assertEquals(removed, false);
  });

  it("should close the connection pool", async () => {
    let poolClosed = false;

    const mockPool = {
      connect: () => Promise.resolve(mockClient),
      end: () => {
        poolClosed = true;
        return Promise.resolve();
      },
    };

    const localDlq = new PostgresDeadLetterQueue(mockPool as any);
    await localDlq.close();

    assertEquals(poolClosed, true);
  });
});
