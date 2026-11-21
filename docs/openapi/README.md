# WireMock.Net Admin API

`wiremock-admin-api.yaml` is the WireMock.Net OpenAPI 3.0.1 contract supplied
for this project. Its `info.version` is `2.12.0`. It replaces the Java WireMock
specification; the two admin APIs have different payload formats.

Reference: [official WireMock.Net admin API documentation](https://wiremock.org/dotnet/admin-api-reference/).
Integration tests run against **`sheyenrath/wiremock.net:2.31.0`**, independently
of the reference document's version. The supplied specification is retained as-is.

The app reads `GET /__admin/mappings`, `GET /__admin/requests`, and
`GET /__admin/requests/{guid}`. Lists are plain arrays. Mapping definitions use
`Guid`, `Title`, `Request`, `Response`, and native `Matcher` / `Matchers` objects.
The server normalizes these for display and preserves additional .NET fields
when editing. Full JSON in the mock editor uses the native WireMock.Net format.

Mock writes use `POST /__admin/mappings`, `PUT /__admin/mappings/{guid}`, and
`DELETE /__admin/mappings/{guid}`. Create/update responses are acknowledgements,
so the app reads the saved definition with `GET /__admin/mappings/{guid}`.
`SaveToFile` controls WireMock.Net's own mapping persistence.

Nearest-mock suggestions use each log's `PartialMappingGuid` and
`PartialRequestMatchResult.AverageTotalScore`, as recorded by WireMock.Net's
matcher engine. This works with archived logs after the upstream journal is
cleared. The app does not call Java's `POST /__admin/near-misses/request`.
A suggestion requires that the mapping was observed by
the app. All saved mocks remain available for manual comparison.

Compose health checks use `GET /__admin/health` on container port 80. Enable
the admin interface on custom WireMock.Net deployments. The app does not alter
the server's global settings or clear its journal.
