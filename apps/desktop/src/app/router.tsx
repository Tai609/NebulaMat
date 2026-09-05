import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "./layout/AppShell";
import { LiveSessionPage } from "./routes/LiveSessionPage";
import { SkillsPage } from "./routes/SkillsPage";
import { NotebooksPage } from "./routes/NotebooksPage";
import { FilesPage } from "./routes/FilesPage";
import { RunsPage } from "./routes/RunsPage";
import { ProjectsPage } from "./routes/ProjectsPage";
import { HistoryPage } from "./routes/HistoryPage";
import { SettingsPage } from "./routes/SettingsPage";
import { DftReviewPage } from "./routes/DftReviewPage";
import { MaterialsDesignPage } from "./routes/MaterialsDesignPage";
import { KnowledgeBasePage } from "./routes/KnowledgeBasePage";
import { ExperimentDatabasePage } from "./routes/ExperimentDatabasePage";
import { VaspFlowPage } from "./routes/VaspFlowPage";
import { NotFound } from "./routes/NotFound";

const GraphPage = lazy(() =>
  import("./routes/GraphPage").then((module) => ({ default: module.GraphPage })),
);

export const routes: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/live" replace /> },
      { path: "live", element: <LiveSessionPage /> },
      { path: "live/:sessionId", element: <LiveSessionPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "notebooks", element: <NotebooksPage /> },
      { path: "files", element: <FilesPage /> },
      { path: "runs", element: <RunsPage /> },
      { path: "dft-review", element: <DftReviewPage /> },
      { path: "materials", element: <MaterialsDesignPage /> },
      { path: "knowledge", element: <KnowledgeBasePage /> },
      { path: "experiments", element: <ExperimentDatabasePage /> },
      { path: "vasp", element: <VaspFlowPage /> },
      {
        path: "graphs",
        element: (
          <Suspense fallback={<div className="h-full animate-pulse bg-surface-2/30" />}>
            <GraphPage />
          </Suspense>
        ),
      },
      { path: "research", element: <Navigate to="/live" replace /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "history", element: <HistoryPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "settings/:section", element: <SettingsPage /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
