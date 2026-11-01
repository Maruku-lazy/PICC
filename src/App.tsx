import { Navigate, Route, Routes } from 'react-router-dom';
import { useDemo } from './context/DemoContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import StudentDashboard from './pages/StudentDashboard';
import ApplicationPage from './pages/ApplicationPage';
import RegistrarDashboard from './pages/RegistrarDashboard';
import RegistrarApplication from './pages/RegistrarApplication';
import RoadmapPage from './pages/RoadmapPage';
import AcademicManagement from './pages/AcademicManagement';
import CurriculumManagement from './pages/CurriculumManagement';
import type { DemoRole } from './types';

function Protected({ expected, children }: { expected: DemoRole; children: React.ReactNode }) {
  const { role, loading } = useDemo();
  if (loading) return <div className="auth-loading" role="status">Loading your account…</div>;
  if (!role) return <Navigate to="/login" replace />;
  if (role !== expected) return <Navigate to={`/${role}/dashboard`} replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const { role, loading } = useDemo();
  if (loading) return <div className="auth-loading" role="status">Loading your account…</div>;
  return (
    <Routes>
      <Route path="/login" element={role ? <Navigate to={`/${role}/dashboard`} replace /> : <LoginPage />} />
      <Route path="/student/dashboard" element={<Protected expected="student"><StudentDashboard /></Protected>} />
      <Route path="/student/application" element={<Protected expected="student"><ApplicationPage /></Protected>} />
      <Route path="/registrar/dashboard" element={<Protected expected="registrar"><RegistrarDashboard /></Protected>} />
      <Route path="/registrar/applications/:id" element={<Protected expected="registrar"><RegistrarApplication /></Protected>} />
      <Route path="/registrar/academics" element={<Protected expected="registrar"><AcademicManagement /></Protected>} />
      <Route path="/registrar/curricula" element={<Protected expected="registrar"><CurriculumManagement /></Protected>} />
      <Route path="/registrar/roadmap" element={<Protected expected="registrar"><RoadmapPage /></Protected>} />
      <Route path="*" element={<Navigate to={role ? `/${role}/dashboard` : '/login'} replace />} />
    </Routes>
  );
}
