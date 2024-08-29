# migraphile

A migration tool that combines Migra and Graphile Migrate

## Installation

```bash
yarn add migraphile
```

## How It Works

Migraphile is a wrapper around [Migra](https://github.com/djrobstep/migra) and allows users to enable drift detection with
[Graphile Migrate](https://github.com/graphile/migrate). With both of the features below, a developer can enable a smooth
experience in generating and applying migrations to their database based on changes to 
a schema (orm) database.

### Drift Detection

To do this, you will need to add the following to your `.gmrc` file that graphile-migrate produces.

```json5
{
  "connectionString": "...",
  "shadowConnectionString": "...",
  "rootConnectionString": "...",
  "migrationsFolder": "./",
  
  // Previously managed via BASELINE_FILE
  "afterReset": "schema/supabase.sql",
  
  // Simulate what v1.0.* would have done
  "beforeCurrent": [
    {
      "_": "command",
      "command": "yarn migraphile fix_drift"
    }
  ],
  "afterAllMigrations": [
    {
      "_": "command",
      "command": "yarn migraphile fix_drift"
    }
  ]
}
```

The fix_drift command is smart enough to run the necessary migrations to fix the drift. This is done by comparing the
shadow database to the local database. The fixes are then applied to the local database. This command is intended to be
called within the graphile-migrate process.

### Generate Migrations 

You will need to run `yarn migraphile` to enable migration generation. This will listen for commands and
generate a migration file to the given `OUTPUT_FILE_PATH`. For graphile-migrate this is usually `migrations/current/1-current.sql`.

## Requirements

- Docker: Migraphile uses Docker to run Migra in a container as it is a python application.
