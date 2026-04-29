import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2"

function hasFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === "function"
}

function summarizeClient(client: OpencodeClient) {
  return {
    global: {
      health: hasFunction(client.global.health),
      event: hasFunction(client.global.event),
    },
    session: {
      list: hasFunction(client.session.list),
      create: hasFunction(client.session.create),
      messages: hasFunction(client.session.messages),
      message: hasFunction(client.session.message),
      prompt: hasFunction(client.session.prompt),
      promptAsync: hasFunction(client.session.promptAsync),
      status: hasFunction(client.session.status),
    },
  }
}

const baseUrl = process.argv[2] ?? process.env.OPENCODE_BASE_URL
const client = createOpencodeClient({
  baseUrl: baseUrl ?? "http://127.0.0.1:4096",
  directory: process.cwd(),
})

console.log(JSON.stringify({ imported: true, baseUrl: baseUrl ?? null, api: summarizeClient(client) }, null, 2))

if (baseUrl) {
  const health = await client.global.health(undefined, { throwOnError: true })
  console.log(JSON.stringify({ health: health.data }, null, 2))

  const sessions = await client.session.list({ limit: 1 }, { throwOnError: true })
  console.log(JSON.stringify({ sessionListOk: true, sessionCount: sessions.data?.length ?? 0 }, null, 2))
}
