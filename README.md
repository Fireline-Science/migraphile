# migraphile

A migration tool that combines Migra and Graphile Migrate

## Installation

```bash
yarn add migraphile
```

## How It Works

Migraphile is a wrapper around [Migra](https://github.com/djrobstep/migra)
and [Graphile Migrate](https://github.com/graphile/migrate).
The main difference is that migrations will be automatically generated by Migra, and then run by Graphile Migrate. Drift
detection is a key feature of Migraphile. Your local database will automatically account for drift, and will be
reset back to the state of the shadow database. This allows migrations to not need to be idempotent.

To see commands that are available, run `migraphile`.

## Requirements

* Docker: Migraphile uses Docker to run Migra in a container as it is a python application.
