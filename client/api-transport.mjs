// The API has its own HTTPS origin. Cookies and redirects must never carry a session.
export function createApiTransport(base, {fetchImpl = globalThis.fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
  const endpoint = new URL(base);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new TypeError('Invalid API origin');

  return async function request(path, {method = 'GET', headers, body, blob = false, idempotent = false, timeoutMs = method === 'GET' ? 15000 : (idempotent ? 25000 : 90000), retry = true} = {}) {
    if (typeof path !== 'string' || /[\u0000-\u0020\\]/.test(path)) throw new TypeError('Invalid API path');
    const url = new URL(path, endpoint);
    if (!path.startsWith('/api/') || url.origin !== endpoint.origin || !url.pathname.startsWith('/api/') || url.hash) throw new TypeError('Invalid API path');
    if (!['GET', 'POST'].includes(method)) throw new TypeError('Invalid API method');
    const canRetry = Boolean(retry && (method === 'GET' || idempotent === true));
    const attempts = !canRetry ? 1 : (method === 'POST' && idempotent ? 3 : 2);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url.href, {method, headers, body, mode: 'cors', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal});
        if ((method === 'GET' || idempotent) && [502, 503, 504].includes(response.status) && attempt + 1 < attempts) {
          await response.body?.cancel();
        } else {
          const contentType = response.headers.get('content-type') || '';
          if (!(blob && response.ok) && !/^application\/json(?:;|$)/i.test(contentType)) throw new Error('Dịch vụ trả về dữ liệu không hợp lệ. Vui lòng thử lại sau.');
          const data = blob && response.ok ? await response.blob() : await response.json();
          return {ok: response.ok, status: response.status, data};
        }
      } catch (error) {
        // Non-idempotent writes may already have reached the server. Never submit them automatically twice.
        const networkFailure = controller.signal.aborted || error instanceof TypeError;
        if (!networkFailure) throw error;
        if (attempt + 1 === attempts) {
          throw new Error(method === 'POST'
            ? (idempotent
                ? 'Chưa kết nối được máy chủ để lưu thay đổi. Vui lòng kiểm tra mạng và bấm Lưu lại.'
                : 'Kết nối bị gián đoạn. Hãy kiểm tra trạng thái trước khi gửi lại để tránh thao tác trùng.')
            : 'Chưa kết nối được dịch vụ. Vui lòng kiểm tra mạng và thử lại.');
        }
      } finally {
        clearTimeout(timer);
      }
      await pause(attempt === 0 ? 300 : 750);
    }
  };
}
