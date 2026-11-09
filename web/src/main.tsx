import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { QuotaIndicator } from "./components/QuotaIndicator";
import { ProcessesPage } from "./pages/Processes";
import { QuotaPage } from "./pages/Quota";
import { useQuotaAlerts } from "./state/alerts";
import { EventsTab } from "./pages/session/EventsTab";
import { OverviewTab } from "./pages/session/OverviewTab";
import { PipelineTab } from "./pages/session/PipelineTab";
import { SessionLayout } from "./pages/session/SessionLayout";
import { SessionsPage } from "./pages/Sessions";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/session.css";
import "./styles/flow.css";
import "./styles/pipeline.css";
import "./styles/quota.css";

// React Flow and dagre are heavy: loaded only when the Flow tab opens.
const FlowTab = lazy(() => import("./pages/session/FlowTab").then((m) => ({ default: m.FlowTab })));

function App() {
  useQuotaAlerts();
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
          <NavLink to="/quota">Quota</NavLink>
        </nav>
        <QuotaIndicator />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/processes" element={<ProcessesPage />} />
          <Route path="/quota" element={<QuotaPage />} />
          <Route path="/sessions/:id" element={<SessionLayout />}>
            <Route index element={<OverviewTab />} />
            <Route path="events" element={<EventsTab />} />
            <Route
              path="flow"
              element={
                <Suspense fallback={<p className="empty">Loading…</p>}>
                  <FlowTab />
                </Suspense>
              }
            />
            <Route path="pipeline" element={<PipelineTab />} />
          </Route>
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
