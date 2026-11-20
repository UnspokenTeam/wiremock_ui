# Wiretap

A Nuxt UI workspace for understanding WireMock traffic. Browse the request
journal, filter matched and unmatched requests, search mock routes, and compare
**any mock with any received request**.

## Run locally

Use Node **24.11+** (or 22.21+) and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
# Set NUXT_WIREMOCK_BASE_URL in .env to your instance address.
pnpm dev
```

Open [localhost:3000](http://localhost:3000). The default WireMock address is
`http://localhost:8080`. The connection settings panel shows the configured
address. Requests are fetched by the Nuxt server, so no WireMock CORS setup is
needed. Only the server receives admin authentication credentials.

Try the separate, clearly labeled [demo workspace](http://localhost:3000/?demo=1)
without connecting a server. Demo mode never silently replaces real data.

| Environment variable | Purpose |
| --- | --- |
| `NUXT_WIREMOCK_BASE_URL` | Instance root, including an optional context path. A trailing `/__admin` is accepted. |
| `NUXT_WIREMOCK_AUTH_TOKEN` | Optional bearer token. Takes precedence over basic authentication. |
| `NUXT_WIREMOCK_USERNAME` | Optional basic authentication username. |
| `NUXT_WIREMOCK_PASSWORD` | Optional basic authentication password. |

Environment variables are read at runtime in the production image. Restart the
app after changing them. Nuxt loads `.env` during development; the production
server uses the environment passed to its process or container.

## Explore traffic

- **Request journal:** all, matched, and unmatched filters; HTTP method and
  URL/request-ID search; request and response inspection; nearest-mock suggestions.
- **Mock routes:** search by route, name, method, ID, scenario, or metadata;
  inspect request patterns, response definitions, and full mappings.
- **Compare requests:** independently searchable request and mock selectors.
  A selection is retained while choosing the other side of the pair.
- Live refresh every five seconds, pause/resume, manual refresh, and a visible
  stale snapshot when a connection fails. The journal starts with the newest
  500 requests; **Load older** increases the window up to 10,000. Counts and
  filters apply to the loaded window; the total journal size is shown separately.
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

The UI uses read/query operations and does not modify mappings or clear traffic.
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
  -e NUXT_WIREMOCK_BASE_URL=http://host.docker.internal:8080 \
  wiretap:local
```

The multi-stage image runs as a non-root user, contains only Nuxt’s production
output, listens on port 3000, and includes a health check at `/api/health`.
The health endpoint checks the UI service independently of WireMock availability.

## GitHub Actions and registry

[`.github/workflows/build.yml`](.github/workflows/build.yml) checks types, runs
comparison/search tests, and builds and verifies the production image against a
real WireMock using Docker Compose. The same Compose test runs locally and in CI.

Pushes to `main`/`master`, `v*` tags, and manual runs also publish the multi-platform
image (`linux/amd64`, `linux/arm64`) to **`ghcr.io/<owner>/<repository>`**, using the
repository’s `GITHUB_TOKEN` with `packages: write`. No registry password secret is
needed. Pull requests build without publishing or logging into the registry.
Tags include the branch, commit SHA, `latest` on the default branch, and semantic
version tags for releases. Repository/organization Actions policy must allow
package publishing. There is no Git remote configured in the supplied checkout;
the workflow will run after the project is pushed to your GitHub repository.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
```

The unit tests cover query duplicates and encoding, path templates, headers,
body rules, binary bodies, other request blocks, patch reconstruction, route
search, and match status independent of HTTP response codes.

Run the full integration check with Docker Compose. This builds the production
app and a test runner, starts the official **WireMock 3.13.2** image, waits for
both services to be healthy, and runs the tests over the Compose network. Only
Docker is required on the host:

```sh
docker compose -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from tests
docker compose -f compose.test.yaml down --volumes --remove-orphans
```

The command exits with the test runner’s exit code. The test creates its own
mapping and sends real matching and non-matching requests. It checks the journal,
an intentionally matched 404, nearest mocks, route search, and header/query/path/
body diffs derived from WireMock’s actual logged values. Fixtures are removed
when the test finishes.

To keep the two services running for manual inspection instead:

```sh
docker compose -f compose.test.yaml up --build --wait wiremock wiretap
docker compose -f compose.test.yaml run --rm tests
```

The app is at [localhost:3100](http://localhost:3100) and WireMock is at
[localhost:18089](http://localhost:18089). The app connects to `http://wiremock:8080`
inside the Compose network. Override `WIRETAP_TEST_PORT` and `WIREMOCK_TEST_PORT`
if the default host ports are occupied. This test stack is separate from the
normal `compose.yaml`, which connects to your existing WireMock.

`pnpm test:integration` remains available for another dedicated test environment;
set both `WIRETAP_TEST_URL` and `WIREMOCK_TEST_URL` or that direct test is skipped.
