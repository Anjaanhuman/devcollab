import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoadingState } from './components/common/StateView.jsx';
import PublicLayout from './components/layout/PublicLayout.jsx';
import AppShell from './components/layout/AppShell.jsx';
import ProtectedRoute from './routes/ProtectedRoute.jsx';
import AdminRoute from './routes/AdminRoute.jsx';

const LandingPage = lazy(() => import('./pages/LandingPage.jsx'));
const AuthPage = lazy(() => import('./pages/AuthPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ProjectsPage = lazy(() => import('./pages/ProjectPages.jsx').then((module) => ({ default: module.ProjectsPage })));
const ProjectDetailPage = lazy(() => import('./pages/ProjectPages.jsx').then((module) => ({ default: module.ProjectDetailPage })));
const TeamsPage = lazy(() => import('./pages/ProjectPages.jsx').then((module) => ({ default: module.TeamsPage })));
const TasksPage = lazy(() => import('./pages/TasksPage.jsx'));
const MessagesPage = lazy(() => import('./pages/MessagesPage.jsx'));
const SnippetsPage = lazy(() => import('./pages/SnippetPages.jsx').then((module) => ({ default: module.SnippetsPage })));
const SnippetDetailPage = lazy(() => import('./pages/SnippetPages.jsx').then((module) => ({ default: module.SnippetDetailPage })));
const CommunityPage = lazy(() => import('./pages/CommunityPage.jsx'));
const CommunityDetailPage = lazy(() => import('./pages/CommunityDetailPage.jsx'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const AdminPage = lazy(() => import('./pages/AdminPage.jsx'));
const DeveloperProfilePage = lazy(() => import('./pages/DeveloperProfilePage.jsx'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage.jsx'));

function NotFoundPage() {
  return <main className="not-found page-width"><span className="eyebrow">404 · NOT FOUND</span><h1>This page isn’t here.</h1><p>The link may be out of date, or the content may have moved.</p><a href="/" className="button">Return home</a></main>;
}

export default function App() {
  return <Suspense fallback={<main className="public-content page-width"><LoadingState label="Loading DEVCOLLAB…" /></main>}><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/login" element={<AuthPage mode="login" />} />
    <Route path="/register" element={<AuthPage mode="register" />} />
    <Route path="/forgot-password" element={<AuthPage mode="forgot" />} />
    <Route path="/reset-password" element={<AuthPage mode="reset" />} />
    <Route element={<PublicLayout />}>
      <Route path="/developers/:userId" element={<DeveloperProfilePage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      <Route path="/community" element={<CommunityPage />} />
      <Route path="/community/:postId" element={<CommunityDetailPage />} />
      <Route path="/snippets" element={<SnippetsPage />} />
      <Route path="/snippets/:snippetId" element={<SnippetDetailPage />} />
    </Route>
    <Route element={<ProtectedRoute />}>
      <Route path="/workspace/:projectId" element={<WorkspacePage />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/mine" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="messages" element={<MessagesPage />} />
        <Route path="snippets" element={<SnippetsPage />} />
        <Route path="snippets/:snippetId" element={<SnippetDetailPage />} />
        <Route path="community" element={<CommunityPage />} />
        <Route path="community/:postId" element={<CommunityDetailPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route element={<AdminRoute />}><Route path="admin" element={<AdminPage />} /></Route>
      </Route>
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Routes></Suspense>;
}
