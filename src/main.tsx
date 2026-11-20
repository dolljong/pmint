import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import TheoryPage from "./TheoryPage";
import "./styles.css";

/** #theory 이면 원리 설명 페이지. 계산기는 숨기기만 해서 입력 상태를 보존한다. */
function isTheoryHash(): boolean {
  return window.location.hash.startsWith("#theory");
}

function Root() {
  const [theory, setTheory] = useState(isTheoryHash);
  useEffect(() => {
    const onHash = () => {
      const next = isTheoryHash();
      setTheory((prev) => {
        if (prev !== next) window.scrollTo(0, 0);
        return next;
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <>
      <div style={theory ? { display: "none" } : undefined}>
        <App />
      </div>
      {theory && <TheoryPage onBack={() => { window.location.hash = ""; }} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
