import type { ServeEvent, StubMapping, Workspace } from '#shared/types/wiremock'

export function demoWorkspace(): Workspace {
  const mappings: StubMapping[] = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      name: 'Update an order',
      priority: 1,
      request: {
        method: 'PATCH',
        urlPathTemplate: '/api/orders/{orderId}',
        pathParameters: { orderId: { matches: 'ord_[a-z0-9]+' } },
        headers: {
          'Content-Type': { equalTo: 'application/json' },
          'X-API-Version': { equalTo: '2026-11' }
        },
        queryParameters: { expand: { equalTo: 'items' } },
        bodyPatterns: [
          {
            equalToJson: {
              status: 'confirmed',
              items: [{ sku: 'STUDIO-01', quantity: 2 }],
              currency: 'USD'
            }
          }
        ]
      },
      response: {
        status: 200,
        jsonBody: { id: 'ord_8f2a', status: 'confirmed' }
      }
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      name: 'List customers',
      request: {
        method: 'GET',
        urlPath: '/api/customers',
        queryParameters: { limit: { equalTo: '20' } }
      },
      response: { status: 200, jsonBody: { customers: [], total: 0 } }
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      name: 'Create an order',
      request: {
        method: 'POST',
        urlPath: '/api/orders',
        headers: { 'Content-Type': { equalTo: 'application/json' } },
        bodyPatterns: [{ matchesJsonPath: '$.items' }]
      },
      response: {
        status: 201,
        jsonBody: { id: 'ord_9c3b', status: 'pending' }
      }
    },
    {
      id: '10000000-0000-4000-8000-000000000004',
      name: 'Get order details',
      request: { method: 'GET', urlPathTemplate: '/api/orders/{orderId}' },
      response: {
        status: 200,
        jsonBody: { id: 'ord_8f2a', status: 'confirmed', items: [] }
      }
    },
    {
      id: '10000000-0000-4000-8000-000000000005',
      name: 'Update inventory',
      request: {
        method: 'PUT',
        urlPathTemplate: '/api/inventory/{sku}',
        bodyPatterns: [{ equalToJson: { available: 42 } }]
      },
      response: { status: 200, jsonBody: { updated: true } }
    },
    {
      id: '10000000-0000-4000-8000-000000000006',
      name: 'End a session',
      request: {
        method: 'DELETE',
        urlPathTemplate: '/api/sessions/{sessionId}'
      },
      response: { status: 204 }
    },
    {
      id: '10000000-0000-4000-8000-000000000007',
      name: 'Service health',
      request: { method: 'GET', urlPath: '/health' },
      response: { status: 200, jsonBody: { status: 'ok' } }
    },
    {
      id: '10000000-0000-4000-8000-000000000008',
      name: 'Search products',
      request: {
        method: 'GET',
        urlPath: '/api/products',
        queryParameters: { q: { contains: 'studio' } }
      },
      response: { status: 200, jsonBody: { products: [] } }
    }
  ]
  const now = Date.now()
  const samples: [string, string, number, boolean, string?][] = [
    [
      'PATCH',
      '/api/orders/ord_8f2a?expand=summary',
      0,
      false,
      JSON.stringify({
        status: 'pending',
        items: [{ sku: 'STUDIO-01', quantity: 1 }],
        currency: 'USD'
      })
    ],
    ['GET', '/api/customers?limit=20', 1, true],
    [
      'POST',
      '/api/orders',
      2,
      true,
      '{"items":[{"sku":"STUDIO-01","quantity":2}]}'
    ],
    ['GET', '/api/orders/ord_8f2a', 3, true],
    ['PUT', '/api/inventory/STUDIO-01', 4, false, '{"available":0}'],
    ['DELETE', '/api/sessions/sess_a19f', 5, true],
    ['GET', '/health', 6, true],
    ['GET', '/api/customers?limit=50', 1, false],
    ['GET', '/api/products?q=studio', 7, true],
    ['POST', '/api/orders', 2, false, '{"currency":"EUR"}'],
    ['GET', '/api/orders/ord_7a1c', 3, true],
    ['GET', '/api/customers?limit=20', 1, true]
  ]
  const requests: ServeEvent[] = samples.map(
    ([method, url, index, matched, body], i) => ({
      id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      request: {
        method,
        url,
        absoluteUrl: `http://localhost:8080${url}`,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(i === 0 ? { 'X-API-Version': '2026-10' } : {}),
          'X-Request-Id': `req_${['a8f291', 'b7c310', 'c9d423', 'd2e551'][i % 4]}`,
          Accept: 'application/json'
        },
        body: body ?? '',
        cookies: {},
        clientIp: '172.18.0.3',
        loggedDate: now - i * 17400,
        loggedDateString: new Date(now - i * 17400).toISOString()
      },
      wasMatched: matched,
      ...(matched ? { stubMapping: mappings[index] } : {}),
      responseDefinition: matched
        ? mappings[index]!.response
        : { status: 404, fromConfiguredStub: false },
      response: {
        status: matched ? mappings[index]!.response.status : 404,
        body: matched
          ? JSON.stringify(mappings[index]!.response.jsonBody ?? '')
          : 'No response could be served as there are no stub mappings matching this request.'
      },
      timing: { totalTime: [8, 3, 12, 4, 6, 2][i % 6] }
    })
  )
  return {
    mappings,
    requests,
    total: requests.length,
    requestJournalDisabled: false,
    baseUrl: 'http://localhost:8080',
    fetchedAt: new Date(now).toISOString()
  }
}
