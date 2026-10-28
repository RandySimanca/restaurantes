import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthWrapper } from './components/AuthWrapper';
import { RequireRole, homeFor } from './components/RequireRole';
import { useAuthStore } from './stores/useAuthStore';
import { Login } from './pages/Login';
import { WaiterDashboard } from './pages/waiter/WaiterDashboard';
import { KitchenDashboard } from './pages/kitchen/KitchenDashboard';
import { CashierDashboard } from './pages/cashier/CashierDashboard';
import { AdminDashboard } from './pages/admin/AdminDashboard';

/** Si ya hay sesión, manda a cada rol a su pantalla; si no, al login. */
const HomeRedirect = () => {
  const { user, profile } = useAuthStore();
  if (user && profile) return <Navigate to={homeFor(profile.role)} replace />;
  return <Navigate to="/login" replace />;
};

const LoginRoute = () => {
  const { user, profile } = useAuthStore();
  if (user && profile) return <Navigate to={homeFor(profile.role)} replace />;
  return <Login />;
};

function App() {
  return (
    <BrowserRouter>
      <AuthWrapper>
        <Routes>
          <Route path="/login" element={<LoginRoute />} />
          {/* El admin puede entrar a todas las pantallas (útil en restaurantes pequeños) */}
          <Route path="/waiter/*" element={<RequireRole roles={['waiter', 'admin']}><WaiterDashboard /></RequireRole>} />
          <Route path="/kitchen/*" element={<RequireRole roles={['kitchen', 'admin']}><KitchenDashboard /></RequireRole>} />
          <Route path="/cashier/*" element={<RequireRole roles={['cashier', 'admin']}><CashierDashboard /></RequireRole>} />
          <Route path="/admin/*" element={<RequireRole roles={['admin']}><AdminDashboard /></RequireRole>} />
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </AuthWrapper>
    </BrowserRouter>
  );
}

export default App;
