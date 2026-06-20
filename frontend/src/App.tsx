import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import NewJob from './pages/NewJob';
import JobDetail from './pages/JobDetail';
import NCRs from './pages/NCRs';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Templates from './pages/Templates';
import Settings from './pages/Settings';
import Appearance from './pages/Appearance';
import Samba from './pages/Samba';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/change-password" element={<ChangePassword />} />

      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route
          path="/jobs/new"
          element={
            <ProtectedRoute roles={['administrator', 'staff']}>
              <NewJob />
            </ProtectedRoute>
          }
        />
        <Route path="/jobs/:id" element={<JobDetail />} />
        <Route
          path="/ncrs"
          element={
            <ProtectedRoute roles={['administrator', 'staff']}>
              <NCRs />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute roles={['administrator', 'staff']}>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/users"
          element={
            <ProtectedRoute roles={['administrator']}>
              <Users />
            </ProtectedRoute>
          }
        />
        <Route
          path="/templates"
          element={
            <ProtectedRoute roles={['administrator']}>
              <Templates />
            </ProtectedRoute>
          }
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="/appearance" element={<Appearance />} />
        <Route
          path="/samba"
          element={
            <ProtectedRoute roles={['administrator']}>
              <Samba />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
