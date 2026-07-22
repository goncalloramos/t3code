import { readDesktopPrimaryBearerToken } from "./desktopAuth";

/**
 * Fetch a primary-environment endpoint using the authentication mechanism for
 * the current host. Desktop renderers use their scoped bearer session while
 * ordinary same-origin browsers continue to use the HttpOnly session cookie.
 */
export async function fetchPrimaryEnvironment(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const bearerToken = await readDesktopPrimaryBearerToken();
  const headers = new Headers(init.headers);
  if (bearerToken) {
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  return fetch(input, {
    ...init,
    headers,
    credentials: bearerToken ? "omit" : (init.credentials ?? "include"),
  });
}
