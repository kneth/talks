---
title: Local-First apps
subtitle: Concepts and examples
author: Kenneth Geisshirt
institute: https://k.zigzak.net/
theme: Copenhagen
aspectratio: 1610
header-includes:
  - |
    \usepackage{fancyvrb}
    \DefineVerbatimEnvironment{Highlighting}{Verbatim}{commandchars=\\\{\},fontsize=\small}
---

# Three questions

- Can your application start without network connectivity?
- Can your users complete a task when connectivity is lost?
- Do you self-host your users' data?

# Agenda

- The Local-First manifesto
- The CAP theorem
- OT and CRDT
- Two examples/demos

# The Local-First manifesto

[You own your data, in spite of the cloud](https://www.inkandswitch.com/essay/local-first/) published in 2019

- Initially: collaboration and ownership
- Also important: privacy 
- Today: geopolitical situation (digital sovereignty)

# The seven ideals

1. Fast - no network roundtrip
2. Data synchronization across multi devices
3. Accessible when offline
4. Seamless collaboration with other users
5. Retain ownership after operations have ceased
6. Security and privacy by default - end-to-end encryption
7. Full control of who and how data is accessed

# The CAP theorem

For any distributed data store, you can only pick two out of three:

1. Consistency
2. Availability
3. Partition tolerance

What it means

- AP - work offline (eventually consistent)
- CP - Database with logical replication
- CA - Single-node database

# Distributed data stores

- [Operational Transformations](https://en.wikipedia.org/wiki/Operational_transformation) (OT)
    - Convergence of operations
    - Device 1: O~1~(S)
    - Device 2: O~2~(S)
    - We need to find O^t^~1~and O^t^~2~ such that O^t^~2~(O~1~(S) = O^t^~1~(O~2~(S))
- [Conflict-free Replicated Data Type](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type) (CRDT)
    - Devices can update replica independently
    - Implement algorithm to resolve inconsistencies

# Automerge

*Documents* are stored in *repositories*

```js
const repo = new Repo({
  network: [network],
  storage: new NodeFSStorageAdapter(`.data/${name}`),
})

let handle = repo.create({ todos: [] })
```

# Automerge - Implementing the commands

```js
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
  // ... more commands
```

#[RxDB - A database-like experience

```js
const db = await createRxDatabase({
  name: "todos", storage: getRxStorageLocalstorage({ localStorage }),
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
```

# RxDB - Replication 

Server:

```js
const server = await listen(PORT)
await startWebsocketServer({ database: db, server })
```

Client:

```js
replicateWithWebsocketServer({
  collection: todos,
  url: `ws://localhost:${PORT}`,
  replicationIdentifier: `todos-ws-${PORT}`,
  live: true,
})
```

# RxDB - Implementing the commands

```js
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
  // ... more commands
```

# Take-home message

- Can your application start without network connectivity?
- Can your users complete a task when connectivity is lost?
- Do you self-host your users' data?

If you answered **no** to any of the questions, you should consider a local-first architecture for your next project

