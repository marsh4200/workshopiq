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
import ClosureRequests from './pages/ClosureRequests';
import InspectionReports from './pages/InspectionReports';
import ClientInspectionReports from './pages/ClientInspectionReports';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Templates from './pages/Templates';
import Settings from './pages/Settings';
import Appearance from './pages/Appearance';
import Samba from './pages/Samba';
import Training from './pages/Training';
import { useAuth } from './context/AuthContext';

// Clients get their own sign-off view of inspection reports; staff/admin get
// the full generate/manage page. Same route, role-branched.
function InspectionReportsRoute() {
  const { isClient } = useAuth();
  return isClient ? <ClientInspectionReports /> : <InspectionReports />;
}

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
          path="/closure-requests"
          element={
            <ProtectedRoute roles={['administrator']}>
              <ClosureRequests />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inspection-reports"
          element={
            <ProtectedRoute>
              <InspectionReportsRoute />
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
        <Route
          path="/training"
          element={
            <ProtectedRoute roles={['administrator']}>
              <Training />
            </ProtectedRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
