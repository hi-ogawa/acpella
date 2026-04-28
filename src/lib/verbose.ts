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
type VerboseOutput = "tool" | "thinking";

export function parseVerboseMode(value: string | undefined): VerboseMode | undefined {
  switch (value) {
    case "off": {
      return "off";
    }
    case "on":
    case "tool": {
      return "tool";
    }
    case "thinking": {
      return "thinking";
    }
    case "all": {
      return "all";
    }
  }
}

export function hasVerboseOutput(mode: VerboseMode | undefined, output: VerboseOutput): boolean {
  return mode === output || mode === "all";
}
