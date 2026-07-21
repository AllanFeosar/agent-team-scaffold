# API Contract — <project name>

> Maintained by **<backend-agent-name>**. Read by **<frontend-agent-name>**
> before building screens/components against these endpoints.
> Format: METHOD /path → request shape → response shape → error codes.
> Overwritten in place as endpoints change — this is a living document, not
> a changelog. Historical/point-in-time context belongs in a handoff report,
> not here.

---

## <Domain group 1, e.g. "Auth"> Endpoints (`/api/v1/<prefix>`)

### <METHOD> <path>
**Request:**
```json
<real or representative request body>
```
**Response `<status>`:**
```json
<real or representative response body>
```
**Errors:** `<status>` <condition>, `<status>` <condition>

---

<!-- One `## <Domain> Endpoints` section per module. Pre-populate every
section with the project's actual existing endpoints before generating —
don't leave this file as pure boilerplate for a codebase that already has
an API surface. -->

## <Planned module> Endpoints (`/api/v1/<prefix>`)
> Not yet implemented. `<backend-agent-name>` adds entries here when built.
