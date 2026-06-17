import { Routes, Route, Navigate } from "react-router-dom";
import { NavBar } from "./components/NavBar.tsx";
import { HomePage } from "./pages/HomePage.tsx";
import { LogPage } from "./pages/LogPage.tsx";
import { ProgressPage } from "./pages/ProgressPage.tsx";
import { PlanPage } from "./pages/PlanPage.tsx";
import { CoachPage } from "./pages/CoachPage.tsx";

export default function App() {
  return (
    <div className="flex flex-col h-full">
      <main className="flex-1 overflow-y-auto pb-16">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/log" element={<LogPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/coach" element={<CoachPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <NavBar />
    </div>
  );
}
