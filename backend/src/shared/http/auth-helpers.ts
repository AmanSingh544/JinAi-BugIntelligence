export function bearerAuth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function basicAuth(username: string, password: string): Record<string, string> {
  const creds = Buffer.from(`${username}:${password}`).toString('base64');
  return { Authorization: `Basic ${creds}` };
}

export function apiKeyAuth(headerName: string, key: string): Record<string, string> {
  return { [headerName]: key };
}

export function tokenAuth(scheme: string, token: string): Record<string, string> {
  return { Authorization: `${scheme} ${token}` };
}
