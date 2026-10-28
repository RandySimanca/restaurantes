import { Routes, Route, useNavigate } from 'react-router-dom';
import { TableGrid } from './TableGrid';
import { OrderView } from './OrderView';
import { useAuthStore } from '../../stores/useAuthStore';
import { LogOut } from 'lucide-react';

export const WaiterDashboard = () => {
  const { profile, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary text-white rounded-lg flex items-center justify-center font-bold">
              R
            </div>
            <h1 className="text-xl font-bold text-slate-800">Mesero</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-600 hidden sm:block">
              {profile?.full_name || 'Usuario'}
            </span>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Cerrar sesión"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        <Routes>
          <Route path="/" element={<TableGrid />} />
          <Route path="/table/:tableId" element={<OrderView />} />
        </Routes>
      </main>
    </div>
  );
};
