# Wiretap

A Nuxt UI workspace for understanding WireMock traffic. Browse the request
journal, filter matched and unmatched requests, search mock routes, and compare
**any mock with any received request**. Create, edit, duplicate, and delete mocks,
switch between saved WireMock instances, and choose your live refresh interval.

## Run locally

Use Node **24.11+** (or 22.21+) and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Set NUXT_WIREMOCK_BASE_URL in .env to your instance address.
pnpm dev
```

Open [localhost:3000](http://localhost:3000). The default WireMock address is
`http://localhost:8080`. Open **Instances & refresh** to add other addresses or
edit a saved instance without restarting the app. Requests are fetched by the
Nuxt server, so no WireMock CORS setup is needed.

Try the separate, clearly labeled [demo workspace](http://localhost:3000/?demo=1)
without connecting a server. Demo mode never silently replaces real data.

| Environment variable       | Purpose                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `NUXT_WIREMOCK_BASE_URL`   | Instance root, including an optional context path. A trailing `/__admin` is accepted. |
| `NUXT_WIREMOCK_AUTH_TOKEN` | Optional bearer token. Takes precedence over basic authentication.                    |
| `NUXT_WIREMOCK_USERNAME`   | Optional basic authentication username.                                               |
| `NUXT_WIREMOCK_PASSWORD`   | Optional basic authentication password.                                               |
| `NUXT_HISTORY_DATABASE_PATH` | SQLite history file; defaults to `./.data/wiretap.sqlite` locally and `/app/.data/wiretap.sqlite` in Docker. |

Environment variables are read at runtime in the production image. Restart the
app after changing these server defaults. Switching or editing instances in the
UI applies immediately. Nuxt loads `.env` during development; the production
server uses the environment passed to its process or container.

## Instances and polling

Open **Instances & refresh** from the instance control near the top of the
sidebar, then **Add instance**. On smaller screens, use its server icon.
Give it a name and an HTTP(S) address, and select **Add & connect**. You can edit
an address later with the pencil button, switch by selecting an instance in
that dialog, or forget an address without deleting any of its WireMock data.
The server-configured default remains available in the list.

Instance names, URLs, the active selection, and the polling rate are saved in
this browser. Switching targets cancels pending reads and clears the previous
snapshot and selection; late responses cannot replace the new instance’s data.
Every mock write uses the instance selected when that operation starts.
The selected instance's saved history is then loaded from the app's database.

URLs must be reachable from the **app server**. For example, an instance in the
same Docker network can use `http://wiremock-secondary:8080`. Context paths and
a trailing `/__admin/` are supported. Embedded credentials, query parameters,
and fragments are not accepted in instance URLs. Environment-configured admin
credentials stay on the server and are only sent to the configured default
address; other saved addresses do not inherit those credentials. Saved browser
profiles currently contain names and URLs, not per-instance authentication.

Choose **1s, 5s, 10s, 20s, 30s, or 60s** from the polling control or settings.
The default is 5 seconds. The next poll is scheduled after the previous one
finishes, so slow connections do not create overlapping requests. Pause/resume,
manual refresh, and skipping reads while the tab is hidden remain available.

## Saved history

The app keeps its own SQLite archive of requests and mock definitions. Every
successful refresh captures the **complete available WireMock journal**, even
when only the newest 500 requests are displayed. Repeated refreshes deduplicate
request IDs. Clearing WireMock's journal, resetting WireMock, or deleting mocks
does not remove captured history. There is no automatic history expiry.

Mocks removed through the app or missing from a successful WireMock sync are
marked **Deleted**. Their last saved definition stays searchable, selectable
for any request comparison, and available to duplicate into a new live mock.
Edit and Delete are disabled for saved deleted mocks. Recreating the same mock
ID in WireMock makes it active again. A connection failure never marks mocks
deleted; saved requests and mocks remain readable while WireMock is offline.

History is isolated by the normalized WireMock URL, including its port and
context path. Switching away and back, reloading the browser, and restarting
the app retain that instance's history. Two profiles for the same normalized
URL share history. Changing a profile's URL selects that address's archive;
forgetting a browser profile does not erase its saved data. The archive belongs
to the app server and is shared by browsers using that server.

Collection happens during live polling or manual refresh. Requests and mocks
removed from WireMock before the app ever observes them cannot be recovered,
except mock snapshots embedded in captured matched requests. Pausing polling or
closing the UI stops collection. Saved definitions retain the latest observed
version per mock ID; each captured request also retains its original embedded
matched-mock snapshot when WireMock provides one.

Locally the database lives in `.data/`, which is excluded from Git and image
builds. Compose mounts the named `wiretap-history` volume at `/app/.data`, so
recreating the app container retains history. Keep this volume when upgrading;
`docker compose down --volumes` intentionally removes it. To back up history,
stop the app and copy the entire data directory, then start it again.

## Manage mocks

Go to **Mock routes → New mock** to create a route. Select an existing route
for **Edit mock**, **Duplicate**, or **Delete**. Deletion asks for confirmation
and keeps the request journal and archived mock intact. Duplication removes the original identity
and creates a separate mapping.

The editor includes name, method, URL matching, priority, persistence, additional
request matchers, and the full response definition. Switch to **Full JSON** for
all WireMock fields, including scenarios, metadata, transformers, custom matchers,
and faults. Advanced fields are retained when switching editor modes or
duplicating a mapping. Validation and WireMock errors stay in the editor with
your draft, so you can correct and retry them.

**Keep on WireMock disk** enables the mapping’s `persistent` flag. Persistence
uses WireMock’s storage: use a writable mounted mappings directory if routes
must remain active after WireMock container recreation. The app's history is
saved independently of that flag. Demo-mode edits affect sample data only.

## Explore traffic

- **Request journal:** all, matched, and unmatched filters; HTTP method and
  URL/request-ID search; request and response inspection; nearest-mock suggestions.
- **Mock routes:** search by route, name, method, ID, scenario, or metadata;
  filter all/active/deleted mocks; inspect saved request patterns, response
  definitions, and full mappings.
- **Compare requests:** independently searchable request and mock selectors.
  A selection is retained while choosing the other side of the pair.
- Configurable live refresh, pause/resume, manual refresh, and a visible
  saved history when a connection fails. The journal starts with the newest
  500 saved requests; **Load older** adds another 500 without a fixed history
  limit. Overview counts cover the full archive; request filters and their tab
  counts apply to the loaded window.
- Light/dark themes, keyboard search shortcut `/`, and a responsive layout.

### Git-style comparisons

Each request block has an expandable diff, line numbers, red removals, green
additions, split/unified layouts, and a changes-only block filter. Download the
full comparison as a `.patch` file.

Blocks cover method, URL, headers, body, query parameters, path parameters,
cookies, form fields, multipart parts, basic authentication, and other matchers.
Path values are extracted from the **selected mock’s** URL template. Repeated
query values are retained. Header names are normalized to lowercase. JSON
bodies using `equalToJson` are formatted with sorted object keys; array order is
retained, and matcher options remain visible.

**Text differences are not WireMock match results.** The journal’s matched state
comes from WireMock, including stubs that intentionally return a 404. Literal
`equalTo` rules are displayed as values for readability; regex, logical,
JSONPath, XML, absence, and custom matchers are retained as configured rules.
Additional unconstrained fields can therefore appear as text differences even
for a matched request. This app does not attempt to reimplement WireMock’s
matcher engine. Large blocks preview up to 2,000 lines; patch downloads contain
the full values.

The UI reads traffic and supports individual mock creation, updates, duplication,
and deletion. It does not clear the request journal.
The [downloaded official OpenAPI spec](docs/openapi/wiremock-admin-api.json),
its source and version are documented in [docs/openapi](docs/openapi/README.md).
Your instance also provides Swagger at `/__admin/docs/`.

## Docker

For a WireMock instance running on your host at port 8080:

```sh
docker compose up --build -d
```

Compose defaults to `http://host.docker.internal:8080` and supplies the Linux
host gateway mapping. To use a different address:

```sh
NUXT_WIREMOCK_BASE_URL=http://your-wiremock:8080 docker compose up --build -d
```

If WireMock runs in another container, attach both containers to the same Docker
network and use WireMock’s service name. `localhost` inside the app container
refers to the app container itself. A `.env` containing a localhost address will
override Compose’s host default; use the address reachable from the container.

Or build and run the image directly:

```sh
docker build -t wiretap:local .
docker run --rm -p 3000:3000 \
  --add-host host.docker.internal:host-gateway \
  -v wiretap-history:/app/.data \
  -e NUXT_WIREMOCK_BASE_URL=http://host.docker.internal:8080 \
  wiretap:local
```

The multi-stage image runs as a non-root user, contains only Nuxt’s production
output, listens on port 3000, and includes a health check at `/api/health`.
The health endpoint checks the UI service independently of WireMock availability.

`Dockerfile` builds the release application. `Dockerfile.test` builds the
integration-test image with the application source, test sources, and
dependencies. It prepares Nuxt's generated files and runs the app in development
mode during tests, without producing a production bundle. Compose uses that
same image for the app and the test runner. To build it directly:

```sh
docker build -f Dockerfile.test -t wiretap-integration:local .
```

## GitHub Actions and registry

[`.github/workflows/build.yml`](.github/workflows/build.yml) uses this flow:

1. **Verify (pull request):** build only the integration-test image. Use it for
   lint, type checks, unit tests, and Docker Compose integration tests against
   two real WireMock instances, including history and restart checks.
2. **Build (after verify succeeds):** build the production image separately and
   push it as
   `ghcr.io/<owner>/<repository>:dev-pr-<number>`.
3. **Merge into `main`/`master`:** find the merged PR, pull its development image,
   retag it with the branch, full commit SHA (`sha-<sha>`), and `latest` on the
   default branch, then push those tags. There is no application build in this job.
4. **Version tag (`v1.2.3`):** pull the existing `sha-<sha>` image and push the
   version aliases (`1.2.3`, `1.2`). Manual runs repeat promotion for the selected
   merged commit.

Publishing uses `GITHUB_TOKEN` with `packages: write`; no registry password
secret is needed. Fork and Dependabot PRs run verification without publishing.
Promotion requires an existing development image from a repository PR; a
missing PR or image fails promotion rather than building another image. Use PRs
for changes to the release branches. Repository/organization Actions policy
must allow package publishing.

The plain Docker pull/tag/push workflow publishes `linux/amd64` images. The
Dockerfiles can also be built locally for the host's native architecture.
Release and test builds have separate GitHub Actions cache scopes. Set
`WIRETAP_TEST_IMAGE` to use a prebuilt integration image for both Compose
services without rebuilding it.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The unit tests cover query duplicates and encoding, path templates, headers,
body rules, binary bodies, other request blocks, patch reconstruction, route
search, match status independent of HTTP response codes, archive deduplication,
deleted-state restoration, per-instance retention, and reopening a saved database.

Run the full integration check with Docker Compose. This builds one integration
image for the app and test runner, starts two official **WireMock 3.13.2** containers, waits for
the services to be healthy, and runs the tests over the Compose network. Only
Docker is required on the host:

```sh
docker compose -f compose.test.yaml up --build --wait wiremock wiremock-secondary wiretap
docker compose -f compose.test.yaml run --rm tests
bash tests/verify-history-restart.sh
docker compose -f compose.test.yaml down --volumes --remove-orphans
```

The test runner exits with the test result. The tests create their own
mapping and sends real matching and non-matching requests. It checks the journal,
an intentionally matched 404, nearest mocks, route search, and header/query/path/
body diffs derived from WireMock’s actual logged values. Fixtures are removed
from WireMock when the tests finish; captured history remains until the test
volume is removed. A second integration test creates, edits, duplicates,
and deletes mocks through the UI’s API on a runtime-selected second instance,
while verifying a mock with the same ID on the default instance stays unchanged.
A history test captures more than 500 real requests, removes journal entries,
deletes mocks externally and through the app, and compares their archived data.
The restart script then stops WireMock and recreates the app container to verify
history remains readable, deleted state survives, and an outage never marks
active mocks deleted. Run these checks only against the dedicated test stack.

To keep the services running for manual inspection instead:

```sh
docker compose -f compose.test.yaml up --build --wait wiremock wiremock-secondary wiretap
docker compose -f compose.test.yaml run --rm tests
```

The app is at [localhost:3100](http://localhost:3100) and WireMock is at
[localhost:18089](http://localhost:18089), with the second WireMock at
[localhost:18090](http://localhost:18090). Add `http://wiremock-secondary:8080` in
the UI to switch to it. Override `WIRETAP_TEST_PORT`, `WIREMOCK_TEST_PORT`, and
`WIREMOCK_SECONDARY_TEST_PORT` if those host ports are occupied. This stack is separate from the
normal `compose.yaml`, which connects to your existing WireMock.

`pnpm test:integration` remains available for another dedicated test environment;
set `WIRETAP_TEST_URL`, `WIREMOCK_TEST_URL`, and `WIREMOCK_SECONDARY_TEST_URL` for
all checks. Tests without their required target URLs are skipped.
