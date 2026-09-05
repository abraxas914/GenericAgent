export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

// Transport failures are never converted to successful domain values. Callers
// own retry policy: a failed write may already have reached the server.
export async function checkedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.error === 'string') message = body.error;
      else if (typeof body.message === 'string') message = body.message;
    } catch { /* Keep the HTTP status for non-JSON failures. */ }
    throw new HttpError(message, response.status);
  }
  return response;
}
