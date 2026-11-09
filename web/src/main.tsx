import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { ProcessesPage } from "./pages/Processes";
import { SessionDetailPage } from "./pages/SessionDetail";
import { SessionsPage } from "./pages/Sessions";
import "./styles.css";

const FlowPage = lazy(() => import("./pages/Flow").then((m) => ({ default: m.FlowPage })));

function App() {
  return (
    <BrowserRouter>
      <header className="topbar">
        <NavLink to="/" className="brand">
          Claude Monitor
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Sessions
          </NavLink>
          <NavLink to="/processes">Processes</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<SessionDetailPage />} />
          <Route path="/processes" element={<ProcessesPage />} />
          <Route
            path="/sessions/:id/flow"
            element={
              <Suspense fallback={<p className="empty">Loading…</p>}>
                <FlowPage />
              </Suspense>
            }
          />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
