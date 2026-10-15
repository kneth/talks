# RxDB todo list

A tiny collaborative todo list in the terminal, built with
[RxDB](https://rxdb.info/) and its WebSocket replication plugin.

## Running

```sh
npm install
```

Open two terminals and start an instance in each:

```sh
node todo.js alice
node todo.js bob
```

Commands: `add <title>`, `done <n>`, `rm <n>`, `list`, `help`, `quit`.

Add or tick off a todo in one terminal and it shows up in the other.

## How it works

- Each todo is a document in an RxDB collection called `todos`.
- The first instance listens on `ws://localhost:3040` and serves its
  database with `startWebsocketServer`. Any later instance replicates its
  own `todos` collection with it using `replicateWithWebsocketServer`.
- The list on screen is a reactive query (`find().$`), so it redraws
  whenever a document changes, locally or through replication.
- Each instance saves its own copy in `.data/<name>.json`, using RxDB's
  localstorage storage with a small file-backed stand-in for
  `localStorage`. So it keeps working when the other instance is gone.

## Try it offline

1. Start `alice` and `bob`, then add a few todos.
2. Quit `alice`, then make some changes in `bob`.
3. Start `alice` again. Its copy loads from disk, then `bob` reconnects
   and pushes the changes it made while offline.

Unlike Automerge, RxDB doesn't merge concurrent edits to the same todo:
when both sides change it, the server's version wins (RxDB's default
conflict handler).

Run `npm run clean` to start over with an empty list.
