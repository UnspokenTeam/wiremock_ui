# WireMock Admin API

`wiremock-admin-api.json` is the unmodified OpenAPI 3.0 specification linked by
the [official WireMock Admin API reference](https://wiremock.org/docs/standalone/admin-api-reference/).

- Download: https://wiremock.org/js/wiremock-admin-api.json
- Retrieved: 2026-11-21
- Specification `info.version`: `3.12.2`
- Upstream: [wiremock/wiremock](https://github.com/wiremock/wiremock), Apache-2.0

A running WireMock instance also exposes its version-specific Swagger UI and
specification under `/__admin/docs/`. The downloaded reference can lag the
running server; the UI preserves additional matcher fields in “Other matchers”.

The app uses `GET /__admin/mappings`, `GET /__admin/requests`,
`GET /__admin/requests/{requestId}`, and `POST /__admin/near-misses/request`.
The last operation is a read-only similarity query. Mock management also uses
`POST /__admin/mappings`, `PUT /__admin/mappings/{stubMappingId}`, and
`DELETE /__admin/mappings/{stubMappingId}`. Updates read the saved mapping back
with `GET /__admin/mappings/{stubMappingId}`. Runtime instance selection applies
to all these operations. The UI does not replay requests or clear the journal.
