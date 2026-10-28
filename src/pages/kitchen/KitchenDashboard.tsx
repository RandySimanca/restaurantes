import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { LogOut, ChefHat, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const KitchenDashboard = () => {
  const { profile, logout } = useAuthStore();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    // Aquí cargaríamos las comandas pendientes. 
    // Por ahora usamos mock data para la UI.
    setOrders([
      { id: '1', table: '5', items: [{ name: 'Hamburguesa Sencilla', qty: 2 }, { name: 'Papas Fritas', qty: 1 }], status: 'pending', time: '10:45 AM' },
      { id: '2', table: '8', items: [{ name: 'Ensalada César', qty: 1 }], status: 'preparing', time: '10:40 AM' },
    ]);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const markAsReady = (orderId: string) => {
    setOrders(current => current.filter(o => o.id !== orderId));
    // Aquí actualizaríamos la DB
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-100">
      <header className="bg-slate-800 shadow-sm border-b border-slate-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 text-white rounded-lg flex items-center justify-center font-bold">
              <ChefHat size={20} />
            </div>
            <h1 className="text-xl font-bold text-white">Cocina</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-300 hidden sm:block">
              {profile?.full_name || 'Chef'}
            </span>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded-lg transition-colors">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full p-4 sm:p-6 lg:p-8 overflow-x-auto">
        <div className="flex gap-6 min-w-max h-[calc(100vh-8rem)]">
          
          {/* Columna: Pendientes */}
          <div className="w-80 flex flex-col bg-slate-800/50 rounded-3xl border border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-700 bg-slate-800 font-bold text-orange-400 flex justify-between">
              <span>PENDIENTES</span>
              <span className="bg-orange-500/20 px-2 py-0.5 rounded-md text-sm">{orders.filter(o => o.status === 'pending').length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {orders.filter(o => o.status === 'pending').map(order => (
                <div key={order.id} className="bg-slate-800 p-4 rounded-2xl border border-slate-700 shadow-lg">
                  <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-700">
                    <span className="font-bold text-lg text-white">Mesa {order.table}</span>
                    <span className="text-sm text-slate-400">{order.time}</span>
                  </div>
                  <ul className="space-y-2 mb-4">
                    {order.items.map((item: any, idx: number) => (
                      <li key={idx} className="flex gap-2">
                        <span className="font-bold text-orange-400">{item.qty}x</span>
                        <span className="text-slate-300">{item.name}</span>
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => setOrders(c => c.map(x => x.id === order.id ? {...x, status: 'preparing'} : x))} className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors">
                    Preparar
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Columna: En Preparación */}
          <div className="w-80 flex flex-col bg-slate-800/50 rounded-3xl border border-slate-700 overflow-hidden">
            <div className="p-4 border-b border-slate-700 bg-slate-800 font-bold text-emerald-400 flex justify-between">
              <span>EN PREPARACIÓN</span>
              <span className="bg-emerald-500/20 px-2 py-0.5 rounded-md text-sm">{orders.filter(o => o.status === 'preparing').length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {orders.filter(o => o.status === 'preparing').map(order => (
                <div key={order.id} className="bg-slate-800 p-4 rounded-2xl border border-emerald-900/30 shadow-lg">
                  <div className="flex justify-between items-center mb-3 pb-3 border-b border-slate-700">
                    <span className="font-bold text-lg text-white">Mesa {order.table}</span>
                    <span className="text-sm text-slate-400">{order.time}</span>
                  </div>
                  <ul className="space-y-2 mb-4">
                    {order.items.map((item: any, idx: number) => (
                      <li key={idx} className="flex gap-2">
                        <span className="font-bold text-emerald-400">{item.qty}x</span>
                        <span className="text-slate-300">{item.name}</span>
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => markAsReady(order.id)} className="w-full py-3 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-xl transition-colors">
                    <Check size={20} /> ¡Listo!
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};
