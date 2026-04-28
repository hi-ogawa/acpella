import type { SessionUpdate } from "@agentclientprotocol/sdk";
import { z } from "zod";

const verboseStringSchema = z.enum(["off", "tool", "thinking", "all"]);

export const verboseModeSchema = z.union([z.boolean(), verboseStringSchema]).transform((value) => {
  if (value === true) {
    return "tool";
  }
  if (value === false) {
    return "off";
  }
  return value;
});

type VerboseMode = z.infer<typeof verboseModeSchema>;

export function parseVerboseMode(value: string | undefined): VerboseMode | undefined {
  const result = verboseStringSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

type SessionUpdateType = SessionUpdate["sessionUpdate"];

export function getVerboseSessionUpdateTypes(
  mode: VerboseMode | undefined,
): Set<SessionUpdateType> {
  switch (mode) {
    case "tool": {
      return new Set(["tool_call"]);
    }
    case "thinking": {
      return new Set(["agent_thought_chunk"]);
    }
    case "all": {
      return new Set(["tool_call", "agent_thought_chunk"]);
    }
    case "off":
    case undefined: {
      return new Set();
    }
  }
}
