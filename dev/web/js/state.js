// 공용 상태: 작업 공간 데이터 + 서버 상태
import { api } from './api.js';

export const state = {
  data: { characters: [], banners: [], storyIndex: [], notices: [], mail: [], version: { contentVersion: 0 }, errors: {} },
  status: null,
  settings: null, // 그림 엔진, ComfyUI 설정 (dev/settings.json)
};

export async function reloadData() {
  state.data = await api.get('/api/data');
  return state.data;
}

export async function reloadSettings() {
  state.settings = await api.get('/api/settings');
  return state.settings;
}

export async function reloadStatus() {
  state.status = await api.get('/api/status');
  return state.status;
}

export const charById = (id) => state.data.characters.find((c) => c.id === id);

/** 목록 저장 (banners / notices / mail / storyIndex) */
export async function saveList(key, items) {
  await api.put(`/api/list/${key}`, items);
  state.data[key] = items;
}
