import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../config/supabase';
import { Users } from 'lucide-react';
import clsx from 'clsx';

interface Table {
  id: string;
  table_number: string;
  capacity: number;
  status: 'available' | 'occupied' | 'waiting_payment' | 'reserved';
}

export const TableGrid = () => {
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchTables();

    // Suscribirse a cambios en tiempo real
    const channel = supabase
      .channel('tables_changes')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tables' },
        (payload) => {
          setTables((current) =>
            current.map((t) => (t.id === payload.new.id ? (payload.new as Table) : t))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchTables = async () => {
    try {
      const { data, error } = await supabase
        .from('tables')
        .select('*')
        .order('table_number');

      if (error) throw error;
      setTables(data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTakeTable = async (table: Table) => {
    if (table.status !== 'available') {
      alert('La mesa no está disponible');
      return;
    }

    try {
      // Llamamos al RPC transaccional que diseñamos en schema.sql
      // El servidor identifica al mesero con auth.uid(); ya no se envía p_waiter_id
      const { error } = await supabase.rpc('take_table', { p_table_id: table.id });

      if (error) throw error;
      
      // Si fue exitoso, navegamos al detalle de la mesa
      navigate(`/waiter/table/${table.id}`);
    } catch (err: any) {
      alert(err.message || 'Error al tomar la mesa. Es posible que otro mesero la haya tomado.');
      fetchTables(); // Refrescar por si acaso
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Cargando mesas...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Mesas</h2>
          <p className="text-slate-500">Selecciona una mesa para atender</p>
        </div>
        <div className="flex gap-4 text-sm font-medium">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-400"></div> Libre
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-rose-400"></div> Ocupada
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {tables.map((table) => {
          const isAvailable = table.status === 'available';
          const isOccupied = table.status === 'occupied';
          const isWaiting = table.status === 'waiting_payment';

          return (
            <button
              key={table.id}
              onClick={() => isAvailable ? handleTakeTable(table) : navigate(`/waiter/table/${table.id}`)}
              className={clsx(
                "relative flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all duration-200 active:scale-95 group",
                isAvailable ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100" :
                isOccupied ? "border-rose-200 bg-rose-50 hover:bg-rose-100" :
                isWaiting ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50"
              )}
            >
              <div className={clsx(
                "text-4xl font-bold mb-2 transition-colors",
                isAvailable ? "text-emerald-700" :
                isOccupied ? "text-rose-700" :
                "text-slate-700"
              )}>
                {table.table_number}
              </div>
              <div className="flex items-center gap-1 text-slate-500 text-sm">
                <Users size={16} />
                <span>{table.capacity}</span>
              </div>
              
              {isAvailable && (
                <div className="absolute inset-0 bg-emerald-600 rounded-2xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-white font-bold">Tomar Mesa</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
      
      {tables.length === 0 && (
        <div className="text-center py-12 text-slate-500 bg-white rounded-2xl border border-slate-200 border-dashed">
          No hay mesas configuradas. Un administrador debe crearlas primero.
        </div>
      )}
    </div>
  );
};
