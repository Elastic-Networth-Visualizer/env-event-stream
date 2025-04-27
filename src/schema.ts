import { Event, SchemaRegistry } from "./types.ts";

/**
 * Interface for JSON schema property definition
 */
interface JsonSchemaProperty {
  type: string;
  required?: string[];
  properties?: Record<string, JsonSchemaProperty>;
  items?: JsonSchemaProperty;
  [key: string]: unknown;
}

/**
 * Interface for JSON schema definition
 */
interface JsonSchema {
  type: string;
  required?: string[];
  properties?: Record<string, JsonSchemaProperty>;
  [key: string]: unknown;
}

/**
 * A schema registry that validates events against JSON schemas
 */
export class JsonSchemaRegistry implements SchemaRegistry {
  private schemas: Map<string, { schema: JsonSchema; version: string }> =
    new Map();

  /**
   * Register a schema for an event type
   */
  registerSchema(eventType: string, schema: unknown, version: string): void {
    if (typeof schema !== "object" || schema === null) {
      throw new Error("Schema must be a valid JSON schema object");
    }

    this.schemas.set(eventType, {
      schema: schema as JsonSchema,
      version,
    });
  }

  /**
   * Validate an event against its registered schema
   */
  validate(event: Event): boolean {
    const schemaEntry = this.schemas.get(event.type);

    // If no schema is registered for this event type, consider it valid
    if (!schemaEntry) {
      return true;
    }

    // Check schema version
    if (event.schemaVersion !== schemaEntry.version) {
      console.warn(
        `Event schema version mismatch: expected ${schemaEntry.version}, got ${event.schemaVersion}`
      );
      // We'll still validate, but with a warning
    }

    return this.validateAgainstSchema(event.payload, schemaEntry.schema);
  }

  /**
   * Get all registered schemas
   */
  getSchemas(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [eventType, schemaEntry] of this.schemas.entries()) {
      result[eventType] = {
        schema: schemaEntry.schema,
        version: schemaEntry.version,
      };
    }
    return result;
  }

  /**
   * Validate data against a JSON schema
   * For a production implementation, consider using a complete JSON Schema validator library
   * such as Ajv (https://ajv.js.org/)
   */
  private validateAgainstSchema(data: unknown, schema: JsonSchema): boolean {
    // Check type
    if (schema.type && !this.validateType(data, schema.type)) {
      return false;
    }

    // Check required properties
    if (
      schema.type === "object" &&
      schema.required &&
      Array.isArray(schema.required) &&
      typeof data === "object" &&
      data !== null
    ) {
      for (const requiredProp of schema.required) {
        if (!(requiredProp in (data as Record<string, unknown>))) {
          return false;
        }
      }
    }

    // Check properties if object
    if (
      schema.type === "object" &&
      schema.properties &&
      typeof data === "object" &&
      data !== null
    ) {
      const objData = data as Record<string, unknown>;

      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        if (propName in objData) {
          if (
            !this.validateAgainstSchema(
              objData[propName],
              propSchema as JsonSchema
            )
          ) {
            return false;
          }
        }
      }
    }

    // Check array items
    if (schema.type === "array" && schema.items && Array.isArray(data)) {
      for (const item of data) {
        if (!this.validateAgainstSchema(item, schema.items as JsonSchema)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Validate a value against a JSON schema type
   */
  private validateType(value: unknown, type: string): boolean {
    switch (type) {
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number";
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return Array.isArray(value);
      case "object":
        return (
          typeof value === "object" && value !== null && !Array.isArray(value)
        );
      case "null":
        return value === null;
      default:
        return true; // Unknown types pass validation
    }
  }
}
