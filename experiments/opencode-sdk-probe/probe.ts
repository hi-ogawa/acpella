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

function summarizeEvent(event: unknown) {
  if (!event || typeof event !== "object") return event
  const record = event as Record<string, unknown>
  const payload = record.payload
  if (!payload || typeof payload !== "object") return record
  const payloadRecord = payload as Record<string, unknown>
  const properties = payloadRecord.properties
  const propertiesRecord = properties && typeof properties === "object" ? (properties as Record<string, unknown>) : undefined
  return {
    directory: record.directory,
    project: record.project,
    workspace: record.workspace,
    type: payloadRecord.type,
    sessionID: propertiesRecord?.sessionID,
    messageID: propertiesRecord?.messageID,
    partID: propertiesRecord?.partID,
    keys: Object.keys(record),
    payloadKeys: Object.keys(payloadRecord),
    propertyKeys: propertiesRecord ? Object.keys(propertiesRecord) : undefined,
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

async function withServer(callback: (next: OpencodeClient, url: string) => Promise<void>) {
  const server = await createOpencodeServer({ port: 0, timeout: 10000 })
  try {
    console.log(JSON.stringify({ serverUrl: server.url }, null, 2))
    await callback(
      createOpencodeClient({
        baseUrl: server.url,
        directory: process.cwd(),
      }),
      server.url,
    )
  } finally {
    server.close()
  }
}

if (baseUrl) {
  await smoke(client)
}

if (mode === "server") {
  await withServer((next) => smoke(next))
}

if (mode === "events") {
  await withServer(async (next) => {
    const abort = new AbortController()
    const events: unknown[] = []
    const subscription = await next.global.event({ signal: abort.signal })
    const reader = (async () => {
      for await (const event of subscription.stream) {
        events.push(event)
        console.log(JSON.stringify({ event: summarizeEvent(event) }, null, 2))
        if (events.length >= 10) abort.abort()
      }
    })().catch((error: unknown) => {
      if (!abort.signal.aborted) throw error
    })

    const title = `sdk-probe-${Date.now()}`
    const session = await next.session.create({ title }, { throwOnError: true })
    console.log(JSON.stringify({ sessionCreated: { id: session.data.id, title: session.data.title } }, null, 2))

    const messages = await next.session.messages({ sessionID: session.data.id }, { throwOnError: true })
    console.log(JSON.stringify({ messagesOk: true, messageCount: messages.data?.length ?? 0 }, null, 2))

    await new Promise((resolve) => setTimeout(resolve, 2000))
    abort.abort()
    await reader
    console.log(JSON.stringify({ eventCount: events.length }, null, 2))
  })
}
