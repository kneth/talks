# My talks

- `temporal` - a brief introduction to JavaScript's `Temporal`
- `cphjs-localfirst` - an introduction to Local-First concepts with examples ([Automerge](https://automerge.org/) and [RxDB](https://rxdb.info/))

## How to convert to PDF

To convert from markdown to PDF:

```shell
pandoc -t beamer -M colorlinks --syntax-highlighting=tango temporal.md -o temporal.pdf
```
