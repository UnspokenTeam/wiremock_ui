import { Buffer } from 'node:buffer'

export function headersForInstance(
  target: string,
  configuredDefault: string,
  credentials: { token: string, username: string, password: string }
): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (target !== configuredDefault) return headers
  if (credentials.token) headers.Authorization = `Bearer ${credentials.token}`
  else if (credentials.username)
    headers.Authorization = `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`
  return headers
}
