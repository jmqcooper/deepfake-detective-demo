/**
 * Validate browser POST origins without relying on `request.url`.
 *
 * Next.js can normalize that URL to the container's bind address. The Host
 * headers retain the browser-facing address across Docker/Podman and reverse
 * proxies, which is the value the Origin header must match.
 */
export function isCrossOriginRequest(request: Request): boolean {
  const originHeader = request.headers.get("origin");
  if (!originHeader) return false;

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return true;
  }

  const firstHeaderValue = (value: string | null): string | null =>
    value?.split(",", 1)[0]?.trim() || null;
  const hosts = [
    firstHeaderValue(request.headers.get("x-forwarded-host")),
    firstHeaderValue(request.headers.get("host")),
  ].filter((value): value is string => Boolean(value));

  if (hosts.length === 0 || !hosts.includes(origin.host)) return true;

  const forwardedProtocol = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  return Boolean(
    forwardedProtocol && origin.protocol !== `${forwardedProtocol}:`,
  );
}
