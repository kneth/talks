# Automerge todo list

A tiny collaborative todo list in the terminal, built with
[Automerge](https://automerge.org/) and
[automerge-repo](https://github.com/automerge/automerge-repo).

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

- The first instance listens on `ws://localhost:3030`. Any later instance
  connects to it.
- The first instance creates the document and writes its URL to
  `doc-url.txt`. The other instances open the same document from that URL.
- Each instance saves its own copy of the document in `.data/<name>`, so it
  keeps working when the other instance is gone.

## Try it offline

1. Start `alice` and `bob`, then add a few todos.
2. Quit `alice`, then make some changes in `bob`.
3. Start `alice` again. Its copy loads from disk, then `bob` reconnects
   and sends the changes it missed.

Run `npm run clean` to start over with an empty list.
