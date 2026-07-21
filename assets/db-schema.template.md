# Database Schema Contract — <project name>

> Maintained by **<database-agent-name>**. Read by **<backend-agent-name>**
> before writing ORM models/queries against these tables.
> Always in real DDL (or the project's schema language — Prisma schema,
> Mongoose schema, etc.). Overwritten in place as schema changes — this is a
> living document, not a migration changelog (that's the Migration history
> table at the bottom).

## Enums
```sql
<real enum types already in the schema, if any>
```

## Tables

### `<table_name>`
```sql
CREATE TABLE <table_name> (
    <column> <type> <constraints>,
    ...
);
```
<Note any non-obvious design decision: soft-delete column, FK indexing
choice, why a field is denormalized, etc. — only if it isn't self-evident
from the DDL.>

<!-- One `### table_name` block per existing table. Pre-populate with the
project's actual current schema before generating — don't leave this file
as pure boilerplate for a codebase that already has a database. -->

## Pending (not yet migrated)
> `<database-agent-name>` adds entries here when a `NEEDS MIGRATION` request
> comes from `<backend-agent-name>`, then moves the entry up to Tables and
> logs it below once the migration lands.

## Migration history
| Revision | Description |
|----------|-------------|
| <rev>    | <what it did> |
