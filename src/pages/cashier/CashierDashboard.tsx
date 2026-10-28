import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/useAuthStore';
import { LogOut, Calculator, CreditCard, Banknote, Landmark } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';

export const CashierDashboard = () => {
  const { profile, logout } = useAuthStore();
  const navigate = useNavigate();
  const [pendingBills, setPendingBills] = useState<any[]>([]);
  const [selectedBill, setSelectedBill] = useState<any | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash'|'card'|'transfer'>('cash');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    // Mock data para el MVP, simulando cuentas de mesas en estado 'waiting_payment'
    setPendingBills([
      { id: 'session_1', tableId: 't1', tableNumber: '5', total: 45000, items: [
        { name: 'Hamburguesa Sencilla', qty: 2, subtotal: 30000 },
        { name: 'Papas Fritas', qty: 1, subtotal: 15000 }
      ]},
      { id: 'session_2', tableId: 't2', tableNumber: '8', total: 120000, items: [
        { name: 'Corte de Carne', qty: 2, subtotal: 90000 },
        { name: 'Vino Tinto', qty: 1, subtotal: 30000 }
      ]}
    ]);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const processPayment = async () => {
    if (!selectedBill) return;
    setProcessing(true);
    
    try {
      // Aquí se insertaría en 'payments' y se llamaría a la RPC 'close_table'
      // Mocked implementation:
      await new Promise(r => setTimeout(r, 1000));
      
      alert(`Pago de $${selectedBill.total} procesado con ${paymentMethod}`);
      setPendingBills(current => current.filter(b => b.id !== selectedBill.id));
      setSelectedBill(null);
    } catch (error) {
      alert('Error procesando pago');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-500 text-white rounded-lg flex items-center justify-center font-bold">
              <Calculator size={20} />
            </div>
            <h1 className="text-xl font-bold text-slate-800">Caja</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-slate-600 hidden sm:block">
              {profile?.full_name || 'Cajero'}
            </span>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 flex gap-6">
        
        {/* Lista de cuentas pendientes */}
        <div className="w-1/3 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h2 className="font-bold text-slate-800">Cuentas Pendientes</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {pendingBills.length === 0 ? (
              <p className="text-center text-slate-500 mt-10">No hay cuentas por cobrar</p>
            ) : (
              pendingBills.map(bill => (
                <button
                  key={bill.id}
                  onClick={() => setSelectedBill(bill)}
                  className={clsx(
                    "w-full text-left p-4 rounded-2xl border transition-all",
                    selectedBill?.id === bill.id 
                      ? "border-indigo-500 bg-indigo-50 shadow-md ring-1 ring-indigo-500" 
                      : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/50"
                  )}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-slate-800 text-lg">Mesa {bill.tableNumber}</span>
                    <span className="font-bold text-indigo-600">${bill.total.toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-500">{bill.items.length} items</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detalle y Cobro */}
        <div className="flex-1 bg-white rounded-3xl border border-slate-200 shadow-sm p-6 flex flex-col">
          {!selectedBill ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
              <Calculator size={48} className="mb-4 opacity-20" />
              <p>Selecciona una cuenta para procesar el pago</p>
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-200">
                <h2 className="text-2xl font-bold text-slate-800">Mesa {selectedBill.tableNumber}</h2>
                <div className="text-right">
                  <p className="text-sm text-slate-500 font-medium">Total a Pagar</p>
                  <p className="text-3xl font-bold text-indigo-600">${selectedBill.total.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto mb-6">
                <h3 className="font-bold text-slate-700 mb-4">Detalle del Pedido</h3>
                <div className="space-y-3">
                  {selectedBill.items.map((item: any, idx: number) => (
                    <div key={idx} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div>
                        <span className="font-bold text-slate-700 mr-2">{item.qty}x</span>
                        <span className="text-slate-600">{item.name}</span>
                      </div>
                      <span className="font-medium text-slate-800">${item.subtotal.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-slate-200">
                <h3 className="font-bold text-slate-700 mb-4">Método de Pago</h3>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  <button 
                    onClick={() => setPaymentMethod('cash')}
                    className={clsx("p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all", paymentMethod === 'cash' ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
                  >
                    <Banknote size={24} /> <span className="font-medium">Efectivo</span>
                  </button>
                  <button 
                    onClick={() => setPaymentMethod('card')}
                    className={clsx("p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all", paymentMethod === 'card' ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
                  >
                    <CreditCard size={24} /> <span className="font-medium">Tarjeta</span>
                  </button>
                  <button 
                    onClick={() => setPaymentMethod('transfer')}
                    className={clsx("p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all", paymentMethod === 'transfer' ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-500" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
                  >
                    <Landmark size={24} /> <span className="font-medium">Transferencia</span>
                  </button>
                </div>
                
                <button
                  onClick={processPayment}
                  disabled={processing}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl transition-colors disabled:opacity-50"
                >
                  {processing ? 'Procesando...' : `Registrar Pago y Cerrar Mesa`}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};
