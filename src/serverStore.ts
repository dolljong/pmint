/**
 * 서버 저장/불러오기 연동 (로그인 사용자 DB).
 *
 * 건설기술 코너(kcsc)가 제공하는 공용 헬퍼 /tools-save.js(window.ToolSave)를 그대로 쓴다.
 * RC단면검토·단면특성·옹벽검토와 같은 방식이라 저장 이름 입력·목록 모달·로그인 안내가 동일하다.
 * 이 앱은 kcsc 와 같은 오리진의 iframe(/pmint/index.html)으로 뜨므로
 * /api/tools/pmint 호출에 로그인 세션 쿠키가 자동으로 실린다.
 *
 * index.html 에 <script src="/tools-save.js"> 를 박지 않고 첫 클릭 때 주입한다 —
 * 빌드 산출물에 절대경로 자산이 있으면 kcsc 의 scripts/sync-pmint.sh 가 동기화를 거부하고,
 * 단독 실행(vite dev)에서도 앱이 그대로 동작해야 하기 때문이다.
 */

/** saved_docs.kind — kcsc lib/tool-kinds.ts 의 TOOL_KINDS 에 등록돼 있어야 한다. */
export const TOOL_KIND = "pmint";

interface ToolSaveApi {
  promptSave(kind: string, buildPayload: () => unknown): Promise<void>;
  openPicker(kind: string, onPick: (payload: unknown, name: string) => void): Promise<void>;
}

declare global {
  interface Window {
    ToolSave?: ToolSaveApi;
  }
}

const HELPER_SRC = "/tools-save.js";
const UNAVAILABLE =
  "서버 저장은 건설기술 코너(civilengr.kr)에 올라간 상태에서만 쓸 수 있습니다.";

let pending: Promise<ToolSaveApi | undefined> | undefined;

function loadToolSave(): Promise<ToolSaveApi | undefined> {
  if (window.ToolSave) return Promise.resolve(window.ToolSave);
  if (!pending) {
    pending = new Promise<ToolSaveApi | undefined>((resolve) => {
      const el = document.createElement("script");
      el.src = HELPER_SRC;
      // 단독 실행에서는 404(또는 index.html 이 실려 파싱만 되고 끝) → undefined 로 떨어진다.
      const done = () => {
        if (!window.ToolSave) pending = undefined; // 다음 클릭 때 다시 시도
        resolve(window.ToolSave);
      };
      el.onload = done;
      el.onerror = done;
      document.head.appendChild(el);
    });
  }
  return pending;
}

/** 이름을 물어보고 현재 입력 상태를 서버에 저장한다(같은 이름이면 덮어쓰기). */
export async function serverSave(buildPayload: () => unknown): Promise<void> {
  const api = await loadToolSave();
  if (!api) {
    window.alert(UNAVAILABLE);
    return;
  }
  await api.promptSave(TOOL_KIND, buildPayload);
}

/** 내 저장 목록 모달을 열고, 고른 문서의 payload 를 넘겨준다. */
export async function serverOpen(onPick: (payload: unknown, name: string) => void): Promise<void> {
  const api = await loadToolSave();
  if (!api) {
    window.alert(UNAVAILABLE);
    return;
  }
  await api.openPicker(TOOL_KIND, onPick);
}
