// A tiny collaborative todo list in the terminal, built on Automerge.
//
// Start two instances in two terminals:
//
//   node todo.js alice
//   node todo.js bob
//
// The first instance listens on a WebSocket port, the second connects to it.
// Every instance keeps its own copy of the document on disk (.data/<name>),
// so it works offline and merges when it reconnects.

import fs from "node:fs"
import readline from "node:readline"
import { WebSocketServer } from "ws"
import { Repo, isValidAutomergeUrl } from "@automerge/automerge-repo"
import {
  WebSocketClientAdapter,
  NodeWSServerAdapter,
} from "@automerge/automerge-repo-network-websocket"
import { NodeFSStorageAdapter } from "@automerge/automerge-repo-storage-nodefs"

// automerge-repo's sync throttle sometimes schedules a negative timeout,
// which only triggers a harmless warning - hide it to keep the demo clean
process.removeAllListeners("warning")
process.on("warning", (w) => {
  if (w.name !== "TimeoutNegativeWarning") console.warn(w)
})

const PORT = 3030
const DOC_URL_FILE = "doc-url.txt"
const name = process.argv[2] ?? `user-${process.pid}`

// --- Networking: be the server if the port is free, otherwise a client ----

function listen(port) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port })
    wss.once("listening", () => resolve(wss))
    wss.once("error", reject)
  })
}

let network
try {
  const wss = await listen(PORT)
  network = new NodeWSServerAdapter(wss)
  console.log(`[${name}] listening on ws://localhost:${PORT}`)
} catch (err) {
  if (err.code !== "EADDRINUSE") throw err
  network = new WebSocketClientAdapter(`ws://localhost:${PORT}`, 1000) // retry every second
  console.log(`[${name}] connecting to ws://localhost:${PORT}`)
}

// --- The repo: local storage + network sync -------------------------------

const repo = new Repo({
  network: [network],
  storage: new NodeFSStorageAdapter(`.data/${name}`),
})

// Both instances must open the *same* document. The first one creates it
// and writes its URL to a file; the others read the URL from that file.
let handle
const savedUrl = fs.existsSync(DOC_URL_FILE)
  ? fs.readFileSync(DOC_URL_FILE, "utf8").trim()
  : null

if (savedUrl && isValidAutomergeUrl(savedUrl)) {
  handle = await repo.find(savedUrl)
} else {
  handle = repo.create({ todos: [] })
  fs.writeFileSync(DOC_URL_FILE, handle.url)
}
console.log(`[${name}] document ${handle.url}`)

// --- Rendering ------------------------------------------------------------

function render() {
  const { todos } = handle.doc()
  console.log()
  if (todos.length === 0) {
    console.log("  (no todos yet)")
  }
  todos.forEach((todo, i) => {
    console.log(`  ${i + 1}. [${todo.done ? "x" : " "}] ${todo.title}`)
  })
  console.log()
}

// --- Commands -------------------------------------------------------------

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${name}> `,
})

function index(arg) {
  const i = Number(arg) - 1
  if (!Number.isInteger(i) || i < 0 || i >= handle.doc().todos.length) {
    console.log("  no such todo")
    return null
  }
  return i
}

// Local edits go through here, so the change listener below can tell them
// apart from changes that arrive from a peer.
let localEdit = false
function edit(fn) {
  localEdit = true
  try {
    handle.change(fn)
  } finally {
    localEdit = false
  }
}

const commands = {
  add(title) {
    if (!title) return console.log("  usage: add <title>")
    edit((doc) => {
      doc.todos.push({ title, done: false })
    })
  },
  done(arg) {
    const i = index(arg)
    if (i === null) return
    edit((doc) => {
      doc.todos[i].done = !doc.todos[i].done
    })
  },
  rm(arg) {
    const i = index(arg)
    if (i === null) return
    edit((doc) => {
      doc.todos.splice(i, 1)
    })
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

// Whenever the document changes - locally or because a peer sent us
// changes - redraw the list.
handle.on("change", () => {
  if (localEdit) return // our own edit, redrawn by the line handler
  readline.clearLine(process.stdout, 0)
  readline.cursorTo(process.stdout, 0)
  console.log(`[${name}] received changes from a peer`)
  render()
  rl.prompt(true)
})

rl.on("line", (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  const command = commands[cmd]
  if (command) {
    if (command(rest.join(" ")) === "quit") return
    if (["add", "done", "rm"].includes(cmd)) render()
  } else if (cmd) {
    console.log(`  unknown command '${cmd}' - try 'help'`)
  }
  rl.prompt()
})

rl.on("close", async () => {
  await repo.flush() // make sure everything is written to disk
  await repo.shutdown()
  process.exit(0)
})

commands.help()
render()
rl.prompt()
