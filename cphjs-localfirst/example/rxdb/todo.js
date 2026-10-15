// A tiny collaborative todo list in the terminal, built on RxDB.
//
// Start two instances in two terminals:
//
//   node todo.js alice
//   node todo.js bob
//
// The first instance listens on a WebSocket port, the second connects to it
// and replicates its todos collection with the first one. Every instance
// keeps its own copy of the data on disk (.data/<name>.json), so it works
// offline and catches up when it reconnects.

import fs from "node:fs"
import http from "node:http"
import readline from "node:readline"
import { createRxDatabase } from "rxdb"
import { getRxStorageLocalstorage } from "rxdb/plugins/storage-localstorage"
import {
  startWebsocketServer,
  replicateWithWebsocketServer,
} from "rxdb/plugins/replication-websocket"

// RxDB's websocket client logs every failed reconnect attempt (header line
// plus error message) - hide it to keep the demo clean
const log = console.log
let skipNext = false
console.log = (...args) => {
  if (args[0] === "--- WAS CLIENT GOT ERROR:") skipNext = true
  else if (skipNext) skipNext = false
  else log(...args)
}

const PORT = 3040
const name = process.argv[2] ?? `user-${process.pid}`

// --- Storage: a localStorage look-alike backed by a JSON file -------------
//
// RxDB's free localstorage storage only needs getItem/setItem/removeItem,
// so we hand it a small object that keeps everything in a file.

const DATA_FILE = `.data/${name}.json`

function fileStorage(path) {
  const items = fs.existsSync(path)
    ? JSON.parse(fs.readFileSync(path, "utf8"))
    : {}
  let dirty = false
  const save = () => {
    if (!dirty) return
    dirty = false
    fs.mkdirSync(".data", { recursive: true })
    fs.writeFileSync(path, JSON.stringify(items))
  }
  const changed = () => {
    if (!dirty) setImmediate(save) // batch the many writes of one RxDB write
    dirty = true
  }
  return {
    getItem: (key) => (key in items ? items[key] : null),
    setItem: (key, value) => {
      items[key] = String(value)
      changed()
    },
    removeItem: (key) => {
      delete items[key]
      changed()
    },
    save,
  }
}

const localStorage = fileStorage(DATA_FILE)

// --- The database ---------------------------------------------------------

const db = await createRxDatabase({
  name: "todos",
  storage: getRxStorageLocalstorage({ localStorage }),
})

await db.addCollections({
  todos: {
    schema: {
      version: 0,
      primaryKey: "id",
      type: "object",
      properties: {
        id: { type: "string", maxLength: 100 },
        title: { type: "string" },
        done: { type: "boolean" },
        createdAt: { type: "number", minimum: 0, maximum: 1e15, multipleOf: 1 },
      },
      required: ["id", "title", "done", "createdAt"],
      indexes: ["createdAt"],
    },
  },
})
const todos = db.todos

// --- Networking: be the server if the port is free, otherwise a client ----

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once("listening", () => resolve(server))
    server.once("error", reject)
    server.listen(port)
  })
}

let replication
try {
  const server = await listen(PORT)
  // Serves the replication protocol for every collection in our database.
  await startWebsocketServer({ database: db, server })
  console.log(`[${name}] listening on ws://localhost:${PORT}`)
} catch (err) {
  if (err.code !== "EADDRINUSE") throw err
  console.log(`[${name}] connecting to ws://localhost:${PORT}`)
  // Don't wait for the connection: we work offline until the server is up.
  replicateWithWebsocketServer({
    collection: todos,
    url: `ws://localhost:${PORT}`,
    replicationIdentifier: `todos-ws-${PORT}`,
    live: true,
  }).then((state) => {
    replication = state
    state.error$.subscribe(() => {}) // the socket reconnects on its own
  })
}

// --- Rendering ------------------------------------------------------------

// The current list, kept up to date by RxDB's reactive query.
let list = []
const query = todos.find({ sort: [{ createdAt: "asc" }] })

function format() {
  if (list.length === 0) return "  (no todos yet)"
  return list
    .map((t, i) => `  ${i + 1}. [${t.done ? "x" : " "}] ${t.title}`)
    .join("\n")
}

let lastRendered = null
function render() {
  lastRendered = format()
  console.log()
  console.log(lastRendered)
  console.log()
}

// --- Commands -------------------------------------------------------------

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${name}> `,
})

function todoAt(arg) {
  const todo = list[Number(arg) - 1]
  if (!todo) console.log("  no such todo")
  return todo
}

const commands = {
  async add(title) {
    if (!title) return console.log("  usage: add <title>")
    await todos.insert({
      id: crypto.randomUUID(),
      title,
      done: false,
      createdAt: Date.now(),
    })
  },
  async done(arg) {
    const todo = todoAt(arg)
    if (!todo) return
    await todo.incrementalPatch({ done: !todo.done })
  },
  async rm(arg) {
    const todo = todoAt(arg)
    if (!todo) return
    await todo.remove()
  },
  list() {
    render()
  },
  help() {
    console.log(`
  add <title>   add a todo
  done <n>      toggle todo n
  rm <n>        remove todo n
  list          show all todos
  quit          exit`)
  },
  quit() {
    rl.close()
    return "quit"
  },
}

// While a local command runs, the query below also fires; we let the
// command redraw the list instead.
let localEdits = 0
let closed = false

// Whenever the result changes - locally or because a peer sent us
// changes - update the list and redraw it if it looks different.
query.$.subscribe((docs) => {
  list = docs
  if (localEdits > 0 || lastRendered === null) return
  if (format() === lastRendered) return
  readline.clearLine(process.stdout, 0)
  readline.cursorTo(process.stdout, 0)
  console.log(`[${name}] received changes from a peer`)
  render()
  rl.prompt(true)
})

rl.on("line", async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  const command = commands[cmd]
  if (command) {
    localEdits++
    try {
      if ((await command(rest.join(" "))) === "quit") return
      if (["add", "done", "rm"].includes(cmd)) {
        list = await query.exec()
        render()
      }
    } finally {
      localEdits--
    }
  } else if (cmd) {
    console.log(`  unknown command '${cmd}' - try 'help'`)
  }
  if (!closed) rl.prompt()
})

rl.on("close", async () => {
  closed = true
  await replication?.cancel()
  await db.close()
  localStorage.save() // make sure everything is written to disk
  process.exit(0)
})

list = await query.exec()
commands.help()
render()
rl.prompt()
