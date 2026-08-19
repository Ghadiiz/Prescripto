import { z } from 'zod';
import { tools } from './tools/index.js';

// Turns the registry into the { name, description, parameters } shape the
// provider client accepts, with `parameters` as plain JSON Schema.
//
// Provider-neutral by design: this file must not mention any provider. It
// emits standard JSON Schema minus a few keywords that function-calling APIs
// commonly reject — which keeps agentService.js the only place that knows who
// we are talking to.

// Keywords no function-calling API we target accepts. Verified against the
// live API: `$schema` and `exclusiveMinimum` each produce a hard 400.
const UNSUPPORTED_KEYWORDS = ['$schema', 'additionalProperties'];

// zod emits `maximum: 9007199254740991` for .int(); it is noise in a tool
// definition and eats tokens on every request.
const JS_MAX_SAFE_INTEGER = 9007199254740991;

const cleanSchema = (schema) => {
  if (!schema || typeof schema !== 'object') return schema;

  const cleaned = {};

  for (const [key, value] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYWORDS.includes(key)) continue;

    // The closest supported equivalent: our exclusive bounds are all `> 0` on
    // integers, where `minimum: 0` would wrongly admit 0 — so nudge to 1 for
    // integers and keep the intent for numbers.
    if (key === 'exclusiveMinimum') {
      cleaned.minimum = schema.type === 'integer' ? value + 1 : value;
      continue;
    }

    if (key === 'exclusiveMaximum') {
      cleaned.maximum = schema.type === 'integer' ? value - 1 : value;
      continue;
    }

    if (key === 'maximum' && value === JS_MAX_SAFE_INTEGER) continue;

    if (key === 'properties') {
      cleaned.properties = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, cleanSchema(sub)]),
      );
      continue;
    }

    if (key === 'items') {
      cleaned.items = cleanSchema(value);
      continue;
    }

    cleaned[key] = value;
  }

  return cleaned;
};

export const buildToolDefinitions = () =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: cleanSchema(z.toJSONSchema(tool.schema)),
  }));
