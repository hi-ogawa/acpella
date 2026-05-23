import { inspect } from "node:util";

export function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    const fields: Record<PropertyKey, unknown> = {};
    Object.assign(fields, error);
    delete fields.message;
    return `${error.name}: ${inspect(
      {
        message: error.message,
        ...fields,
      },
      { depth: 10 },
    )}`;
  }
  return inspect(error, { depth: 10 });
}
