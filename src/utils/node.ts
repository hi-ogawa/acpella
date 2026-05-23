import { inspect } from "node:util";

export function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    const { message, ...fields } = error;
    return `${error.name}: ${inspect(
      {
        message,
        ...fields,
      },
      { depth: 10 },
    )}`;
  }
  return inspect(error, { depth: 10 });
}
