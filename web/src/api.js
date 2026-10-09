export function configuredApiOrigin(value) {
  if (!value) return "";
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("VITE_API_BASE_URL must be an HTTPS origin");
  return url.origin;
}
export const API_ORIGIN = configuredApiOrigin(
  import.meta.env?.VITE_API_BASE_URL || "",
);

export class ApiError extends Error {
  constructor(status, code, requestId) {
    const messages = {
      401: "세션이 만료되었습니다. 다시 프로필을 선택해주세요.",
      403: "이 작업에 대한 권한이 없습니다.",
      404: "항목을 찾을 수 없습니다.",
      409: "다른 변경이 반영되었습니다. 새로고침 후 다시 시도해주세요.",
      422: "입력값이나 사진 조건을 확인해주세요.",
      429: "요청이 많습니다. 잠시 후 다시 시도해주세요.",
      503: "서비스 또는 외부 연동이 준비되지 않았습니다.",
    };
    super(
      messages[status] ||
        "요청을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
    );
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
export function query(values) {
  return new URLSearchParams(
    Object.entries(values).filter(
      ([, v]) => v !== "" && v !== undefined && v !== null,
    ),
  ).toString();
}
export function assetUrl(value, apiOrigin = API_ORIGIN) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value, apiOrigin || "http://localhost:8000");
  } catch {
    return null;
  }
  if (
    apiOrigin &&
    url.origin === apiOrigin &&
    (url.pathname.startsWith("/wardrobe-assets/assets/") ||
      url.pathname.startsWith("/api/v1/card-shares/"))
  )
    return url.href;
  if (
    url.origin === "http://localhost:9000" &&
    url.pathname.startsWith("/wardrobe-assets/")
  )
    return "/local-storage" + url.pathname + url.search;
  if (
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.pathname.startsWith("/api/v1/card-shares/")
  )
    return url.pathname;
  return null;
}
export function safeLink(value) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function createClient(token, onExpired, transport = fetch) {
  const pending = new Map();
  async function request(
    path,
    { method = "GET", body, version, signal, key: explicitKey } = {},
  ) {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    const fingerprint = method + path + (serialized || "");
    const mutation = method !== "GET";
    let key = explicitKey || pending.get(fingerprint);
    if (mutation && !key) {
      key = crypto.randomUUID();
      pending.set(fingerprint, key);
    }
    const headers = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(serialized ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(version ? { "If-Match": String(version) } : {}),
    };
    let response;
    try {
      response = await transport(API_ORIGIN + "/api/v1" + path, {
        method,
        headers,
        body: serialized,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new ApiError(0, "NETWORK_ERROR");
    }
    if (response.status === 401) {
      pending.clear();
      onExpired?.();
    }
    const data =
      response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status < 500) pending.delete(fingerprint);
      throw new ApiError(
        response.status,
        data?.error?.code,
        data?.error?.request_id,
      );
    }
    if (response.status !== 204 && data === null)
      throw new ApiError(0, "INVALID_RESPONSE");
    pending.delete(fingerprint);
    return data;
  }
  return {
    request,
    get: (path, options) => request(path, options),
    send: (path, body, method = "POST", version) =>
      request(path, { method, body, version }),
  };
}
export async function upload(api, file, purpose) {
  if (
    !file ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10485760 ||
    file.size < 1
  )
    throw new Error("PNG·JPEG·WebP 사진을 10MB 이하로 선택해주세요.");
  const bytes = await file.arrayBuffer();
  const checksum = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const intent = await api.send("/assets/upload-intents", {
    file_name: file.name,
    content_type: file.type,
    size_bytes: file.size,
    purpose,
  });
  const target = assetUrl(intent.upload_url);
  if (!target) throw new Error("로컬 저장소 주소를 확인해주세요.");
  const response = await fetch(target, {
    method: "PUT",
    headers: intent.required_headers,
    body: bytes,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error("사진 업로드가 실패했습니다. 다시 선택해주세요.");
  return api.send(`/assets/${intent.asset_id}/finalize`, {
    checksum_sha256: checksum,
  });
}
export async function allGarments(api, signal) {
  return listAll(api, "/garments", {}, signal);
}
export async function listAll(api, path, filters, signal) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const page = await api.get(
      path + "?" + query({ ...filters, limit: 100, offset }),
      {
        signal,
      },
    );
    items.push(...page.items);
    if (offset + 100 >= page.page.total) return items;
  }
}
