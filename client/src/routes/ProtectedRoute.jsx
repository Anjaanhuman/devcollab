import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { LoadingState } from '../components/common/StateView.jsx';

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState label="Restoring your session…" />;
  return user ? <Outlet /> : <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
