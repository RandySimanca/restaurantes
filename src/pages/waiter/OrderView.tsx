import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../config/supabase';
import { ChevronLeft, Plus, Minus, Send, Receipt } from 'lucide-react';

export const OrderView = () => {
  const { tableId } = useParams();
  const navigate = useNavigate();
  const [table, setTable] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<any[]>([]);
  const [cart, setCart] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, [tableId]);

  const fetchData = async () => {
    try {
      // Fetch table
      const { data: tableData } = await supabase
        .from('tables')
        .select('*')
        .eq('id', tableId)
        .single();
      setTable(tableData);

      // Fetch products (en un caso real, por categoría)
      const { data: productsData } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .eq('is_available', true);
      
      setProducts(productsData || []);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (product: any) => {
    setCart(current => {
      const existing = current.find(item => item.product_id === product.id);
      if (existing) {
        return current.map(item =>
          item.product_id === product.id
            ? { ...item, quantity: item.quantity + 1, subtotal: (item.quantity + 1) * item.unit_price }
            : item
        );
      }
      return [...current, {
        product_id: product.id,
        product_name: product.name,
        unit_price: product.price,
        quantity: 1,
        subtotal: product.price
      }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(current => {
      const existing = current.find(item => item.product_id === productId);
      if (existing && existing.quantity > 1) {
        return current.map(item =>
          item.product_id === productId
            ? { ...item, quantity: item.quantity - 1, subtotal: (item.quantity - 1) * item.unit_price }
            : item
        );
      }
      return current.filter(item => item.product_id !== productId);
    });
  };

  const handleSendToKitchen = async () => {
    if (cart.length === 0) return;
    // Lógica para crear orden en Supabase
    // Omitido para mantener simplicidad en el frontend por ahora.
    alert('Comanda enviada a cocina! (Mock)');
    setCart([]);
  };

  if (loading) return <div className="p-8">Cargando...</div>;
  if (!table) return <div className="p-8">Mesa no encontrada</div>;

  const total = cart.reduce((acc, item) => acc + item.subtotal, 0);

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-auto lg:h-[calc(100vh-8rem)] min-h-[calc(100vh-8rem)]">
      
      {/* Menú y Categorías */}
      <div className="flex-1 bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col lg:overflow-hidden min-h-[500px] lg:min-h-0">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => navigate('/waiter')} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200 transition-colors">
            <ChevronLeft size={24} className="text-slate-600" />
          </button>
          <h2 className="text-2xl font-bold text-slate-800">Menú</h2>
        </div>
        
        <div className="flex-1 overflow-y-auto pr-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {products.map(product => (
              <button
                key={product.id}
                onClick={() => addToCart(product)}
                className="bg-slate-50 p-4 rounded-2xl border border-slate-200 text-left hover:border-primary hover:shadow-md transition-all group"
              >
                <div className="aspect-video bg-slate-200 rounded-xl mb-3 overflow-hidden">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">Sin imagen</div>
                  )}
                </div>
                <h3 className="font-bold text-slate-800 leading-tight mb-1">{product.name}</h3>
                <p className="text-primary font-bold text-lg">${Number(product.price).toLocaleString()}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Comanda / Carrito */}
      <div className="w-full lg:w-96 bg-white rounded-3xl p-6 shadow-sm border border-slate-100 flex flex-col min-h-[400px] lg:min-h-0">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-slate-800">Mesa {table.table_number}</h2>
            <p className="text-sm text-emerald-500 font-medium flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Activa
            </p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2">
              <Receipt size={48} className="opacity-20" />
              <p>Agrega productos a la comanda</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item.product_id} className="flex justify-between items-center bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div className="flex-1">
                  <h4 className="font-bold text-slate-800 text-sm">{item.product_name}</h4>
                  <p className="text-slate-500 text-sm">${item.unit_price.toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => removeFromCart(item.product_id)} className="w-8 h-8 flex items-center justify-center bg-white rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 shadow-sm">
                    <Minus size={14} />
                  </button>
                  <span className="font-bold w-4 text-center">{item.quantity}</span>
                  <button onClick={() => addToCart({ id: item.product_id, name: item.product_name, price: item.unit_price })} className="w-8 h-8 flex items-center justify-center bg-white rounded-full border border-slate-200 text-slate-600 hover:bg-slate-100 shadow-sm">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-4 border-t border-slate-100 mt-4 space-y-4">
          <div className="flex justify-between items-center text-lg">
            <span className="font-medium text-slate-600">Subtotal</span>
            <span className="font-bold text-slate-800">${total.toLocaleString()}</span>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={handleSendToKitchen}
              disabled={cart.length === 0}
              className="flex-1 flex items-center justify-center gap-2 bg-primary text-white py-4 rounded-2xl font-bold hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={20} />
              Enviar a cocina
            </button>
          </div>
        </div>
      </div>
      
    </div>
  );
};
