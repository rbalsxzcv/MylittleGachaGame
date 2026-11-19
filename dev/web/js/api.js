// 서버 API 호출 (데이터를 바꾸는 요청에는 보안 헤더 X-Tiny-Dev를 붙임)
import { toast } from './ui.js';

export class ApiError extends Error {
  constructor(message, data) {
    super(message);
    this.data = data;
  }
}

async function call(method, url, body) {
  const opts = { method, headers: {} };
  if (method !== 'GET') opts.headers['X-Tiny-Dev'] = '1';
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError('서버에 연결할 수 없어요. 터미널에서 server.py가 실행 중인지 확인해 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `요청 실패 (${res.status})`, data);
  return data;
}

export const api = {
  get: (url) => call('GET', url),
  post: (url, body = {}) => call('POST', url, body),
  put: (url, body) => call('PUT', url, body),
  del: (url) => call('DELETE', url),
};

/** 오류를 알림으로 보여주는 래퍼: 실패하면 null */
export async function tryApi(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'error', 6000);
    console.error(e);
    return null;
  }
}
