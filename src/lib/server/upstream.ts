import { AppError } from "../domain/validation";

// Every outbound server request must target one of these upstreams over HTTPS.
const ALLOWED_HOSTS = new Set([
  "developer.zhihu.com",
  "openapi.zhihu.com",
  "api.deepseek.com",
]);
// Loopback, link-local, private and reserved ranges are refused outright so a
// crafted path or host can never turn an upstream call into an internal probe.
const BLOCKED_HOST =
  /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|169\.254(\.\d{1,3}){2}|\[?::1\]?|\[?::\]?|\[?fe80:.*|\[?fc[0-9a-f]{2}:.*|\[?fd[0-9a-f]{2}:.*)$/i;

/** Validate an upstream URL before any connection is opened; returns the normalised href. */
export function assertUpstreamUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError("UPSTREAM_URL", "上游地址无效。", 500);
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    BLOCKED_HOST.test(host) ||
    !ALLOWED_HOSTS.has(host)
  )
    throw new AppError("UPSTREAM_URL", "上游地址不在允许范围内。", 500);
  return url.href;
}
