import { Event, SchemaRegistry } from "./types.ts";

/**
 * A simple schema registry that validates events against JSON schemas
 */
export class JsonSchemaRegistry implements SchemaRegistry {
  private schemas: Map<string, { schema: Record<string, unknown>, version: string }> = new Map();
  
  /**
   * Register a schema for an event type
   */
  registerSchema(eventType: string, schema: unknown, version: string): void {
    if (typeof schema !== 'object' || schema === null) {
      throw new Error('Schema must be a valid JSON schema object');
    }
    
    this.schemas.set(eventType, { 
      schema: schema as Record<string, unknown>, 
      version 
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
      console.warn(`Event schema version mismatch: expected ${schemaEntry.version}, got ${event.schemaVersion}`);
      // We'll still validate, but with a warning
    }
    
    // For a complete implementation, we would use a proper JSON Schema validator here.
    // For simplicity, we'll implement a very basic validation.
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
        version: schemaEntry.version
      };
    }
    return result;
  }
  
  /**
   * Basic validation against a JSON schema
   * For a production implementation, use a proper JSON Schema validator library
   */
  private validateAgainstSchema(data: unknown, schema: Record<string, unknown>): boolean {
    // This is a very simplified validator
    // In a real implementation, we would use a full JSON Schema validator
    
    if (schema.type === 'object' && typeof data !== 'object') {
      return false;
    }
    
    if (schema.type === 'array' && !Array.isArray(data)) {
      return false;
    }
    
    if (schema.type === 'string' && typeof data !== 'string') {
      return false;
    }
    
    if (schema.type === 'number' && typeof data !== 'number') {
      return false;
    }
    
    if (schema.type === 'boolean' && typeof data !== 'boolean') {
      return false;
    }
    
    if (schema.required && Array.isArray(schema.required) && typeof data === 'object' && data !== null) {
      for (const requiredProp of schema.required as string[]) {
        if (!(requiredProp in (data as Record<string, unknown>))) {
          return false;
        }
      }
    }
    
    // Add more validation logic as needed
    
    return true;
  }
}