import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from "@opencode-ai/sdk/v2"

const opencodeBinDir = "/home/hiroshi/.opencode/bin"

process.env.PATH = `${opencodeBinDir}:${process.env.PATH ?? ""}`

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

const mode = process.argv[2] ?? "import"
const baseUrl = process.argv[3] ?? process.env.OPENCODE_BASE_URL
const client = createOpencodeClient({
  baseUrl: baseUrl ?? "http://127.0.0.1:4096",
  directory: process.cwd(),
})

console.log(JSON.stringify({ imported: true, mode, baseUrl: baseUrl ?? null, api: summarizeClient(client) }, null, 2))

async function smoke(next: OpencodeClient) {
  const health = await next.global.health(undefined, { throwOnError: true })
  console.log(JSON.stringify({ health: health.data }, null, 2))

  const sessions = await next.session.list({ limit: 1 }, { throwOnError: true })
  console.log(JSON.stringify({ sessionListOk: true, sessionCount: sessions.data?.length ?? 0 }, null, 2))
}

if (baseUrl) {
  await smoke(client)
}

if (mode === "server") {
  const server = await createOpencodeServer({ port: 0, timeout: 10000 })
  try {
    console.log(JSON.stringify({ serverUrl: server.url }, null, 2))
    await smoke(
      createOpencodeClient({
        baseUrl: server.url,
        directory: process.cwd(),
      }),
    )
  } finally {
    server.close()
  }
}
