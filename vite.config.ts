import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // 상대경로 산출: kcsc 사이트의 /pmint/ 하위로 복사해도 자산을 찾도록 한다.
  // 기본값 "/" 이면 index.html 이 /assets/... 를 가리켜 호스트 사이트 루트와 충돌한다.
  base: "./",
  plugins: [react()],
});
