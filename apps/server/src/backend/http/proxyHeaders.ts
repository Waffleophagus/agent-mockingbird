const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function getResponseSetCookies(response: Response) {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    return setCookies;
  }

  const combined = response.headers.get("set-cookie");
  return combined ? [combined] : [];
}

export function copyPassthroughProxyHeaders(response: Response) {
  const headers = new Headers();

  response.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalizedKey) || normalizedKey === "set-cookie") {
      return;
    }
    headers.append(key, value);
  });

  for (const cookie of getResponseSetCookies(response)) {
    headers.append("set-cookie", cookie);
  }

  return headers;
}

export function stripDecodedRepresentationHeaders(headers: Headers) {
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("etag");

  const vary = headers.get("vary");
  if (!vary) {
    return;
  }

  const preservedValues = vary
    .split(",")
    .map(value => value.trim())
    .filter(value => value.length > 0 && value.toLowerCase() !== "accept-encoding");

  if (preservedValues.length === 0) {
    headers.delete("vary");
    return;
  }

  headers.set("vary", preservedValues.join(", "));
}
