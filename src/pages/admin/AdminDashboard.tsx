import { useState, useEffect, type FormEvent, type CSSProperties } from 'react';
import { supabase } from '../../config/supabase';
import { useAuthStore } from '../../stores/useAuthStore';

type UserRole = 'waiter' | 'kitchen' | 'cashier' | 'admin';

interface StaffUser {
  id: string;
  full_name: string;
  role: UserRole;
  status: string;
  created_at: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  waiter: 'Mesero',
  kitchen: 'Cocina',
  cashier: 'Cajero',
};

const ROLE_COLORS: Record<UserRole, string> = {
  admin: '#7c3aed',
  waiter: '#0ea5e9',
  kitchen: '#f97316',
  cashier: '#10b981',
};

const ROLE_ICONS: Record<UserRole, string> = {
  admin: '👑',
  waiter: '🍽️',
  kitchen: '👨‍🍳',
  cashier: '💳',
};

export const AdminDashboard = () => {
  const { profile, restaurant, logout } = useAuthStore();
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'waiter' as UserRole,
  });

  useEffect(() => {
    fetchStaff();
  }, []);

  const fetchStaff = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, status, created_at')
      .eq('restaurant_id', profile?.restaurant_id)
      .order('created_at', { ascending: false });

    if (!error && data) setStaff(data as StaffUser[]);
    setLoading(false);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify(form),
        }
      );

      const result = await res.json();

      if (!res.ok) {
        setError(result.error || 'Error al crear el usuario');
      } else {
        setSuccess(`✅ Usuario "${form.full_name}" creado correctamente`);
        setForm({ full_name: '', email: '', password: '', role: 'waiter' });
        setShowForm(false);
        fetchStaff();
      }
    } catch {
      setError('Error de conexión. Intenta nuevamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (u: StaffUser) => {
    const next = u.status === 'active' ? 'inactive' : 'active';
    if (next === 'inactive' && !window.confirm(`¿Desactivar a ${u.full_name}? No podrá iniciar sesión.`)) return;

    const { error: updateError } = await supabase.from('profiles').update({ status: next }).eq('id', u.id);
    if (updateError) {
      window.alert(updateError.message);
      return;
    }
    setStaff(current => current.map(x => (x.id === u.id ? { ...x, status: next } : x)));
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Hoy';
    if (days === 1) return 'Ayer';
    return `Hace ${days} días`;
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <header style={{
        background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
        borderBottom: '1px solid rgba(139, 92, 246, 0.3)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: '64px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>👑</span>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: '16px' }}>Panel Administrador</div>
            <div style={{ color: '#a78bfa', fontSize: '12px' }}>{restaurant?.name} · {profile?.full_name}</div>
          </div>
        </div>
        <button
          onClick={logout}
          style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            borderRadius: '8px',
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: '14px',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.3)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)')}
        >
          Cerrar sesión
        </button>
      </header>

      <main style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 24px' }}>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
          {(['admin', 'waiter', 'kitchen', 'cashier'] as UserRole[]).map(role => {
            const count = staff.filter(u => u.role === role).length;
            return (
              <div key={role} style={{
                background: 'rgba(30, 41, 59, 0.8)',
                border: `1px solid ${ROLE_COLORS[role]}40`,
                borderRadius: '12px',
                padding: '20px',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '28px', marginBottom: '4px' }}>{ROLE_ICONS[role]}</div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: ROLE_COLORS[role] }}>{count}</div>
                <div style={{ color: '#94a3b8', fontSize: '12px' }}>{ROLE_LABELS[role]}</div>
              </div>
            );
          })}
        </div>

        {/* Título + botón */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h1 style={{ color: '#f1f5f9', fontSize: '20px', fontWeight: 700, margin: 0 }}>
            Personal del Restaurante
          </h1>
          <button
            onClick={() => { setShowForm(!showForm); setError(''); setSuccess(''); }}
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              border: 'none',
              color: 'white',
              borderRadius: '10px',
              padding: '10px 20px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            {showForm ? '✕ Cancelar' : '+ Nuevo usuario'}
          </button>
        </div>

        {/* Mensajes */}
        {success && (
          <div style={{
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            color: '#6ee7b7',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '16px',
            fontSize: '14px',
          }}>
            {success}
          </div>
        )}

        {/* Formulario */}
        {showForm && (
          <div style={{
            background: 'rgba(30, 41, 59, 0.9)',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            borderRadius: '14px',
            padding: '24px',
            marginBottom: '24px',
            animation: 'fadeIn 0.2s ease',
          }}>
            <h2 style={{ color: '#c4b5fd', fontSize: '16px', fontWeight: 600, marginTop: 0, marginBottom: '20px' }}>
              Crear nuevo usuario
            </h2>
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                    Nombre completo *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.full_name}
                    onChange={e => setForm({ ...form, full_name: e.target.value })}
                    placeholder="Ej: Juan Pérez"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                    Rol *
                  </label>
                  <select
                    required
                    value={form.role}
                    onChange={e => setForm({ ...form, role: e.target.value as UserRole })}
                    style={inputStyle}
                  >
                    <option value="waiter">🍽️ Mesero</option>
                    <option value="kitchen">👨‍🍳 Cocina</option>
                    <option value="cashier">💳 Cajero</option>
                    <option value="admin">👑 Administrador</option>
                  </select>
                </div>
                <div>
                  <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    placeholder="usuario@restaurante.com"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ color: '#94a3b8', fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                    Contraseña *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    placeholder="Mínimo 8 caracteres"
                    style={inputStyle}
                  />
                </div>
              </div>

              {error && (
                <div style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#fca5a5',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginTop: '16px',
                  fontSize: '13px',
                }}>
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{
                  marginTop: '20px',
                  width: '100%',
                  background: submitting
                    ? 'rgba(124, 58, 237, 0.4)'
                    : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                  border: 'none',
                  color: 'white',
                  borderRadius: '10px',
                  padding: '12px',
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  fontSize: '15px',
                  transition: 'all 0.2s',
                }}
              >
                {submitting ? 'Creando usuario...' : 'Crear usuario'}
              </button>
            </form>
          </div>
        )}

        {/* Lista de usuarios */}
        <div style={{
          background: 'rgba(30, 41, 59, 0.6)',
          border: '1px solid rgba(51, 65, 85, 0.8)',
          borderRadius: '14px',
          overflow: 'hidden',
        }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              Cargando personal...
            </div>
          ) : staff.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
              No hay usuarios registrados aún
            </div>
          ) : (
            staff.map((user, i) => (
              <div
                key={user.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '16px 20px',
                  borderBottom: i < staff.length - 1 ? '1px solid rgba(51, 65, 85, 0.6)' : 'none',
                  transition: 'background 0.15s',
                  opacity: user.status === 'active' ? 1 : 0.55,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(51, 65, 85, 0.3)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Avatar */}
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: `${ROLE_COLORS[user.role]}20`,
                  border: `2px solid ${ROLE_COLORS[user.role]}60`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  marginRight: '14px',
                  flexShrink: 0,
                }}>
                  {ROLE_ICONS[user.role]}
                </div>

                {/* Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '14px' }}>
                    {user.full_name}
                  </div>
                  <div style={{ color: '#64748b', fontSize: '12px', marginTop: '2px' }}>
                    {timeAgo(user.created_at)}
                  </div>
                </div>

                {/* Rol badge */}
                <span style={{
                  background: `${ROLE_COLORS[user.role]}20`,
                  color: ROLE_COLORS[user.role],
                  border: `1px solid ${ROLE_COLORS[user.role]}40`,
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}>
                  {ROLE_LABELS[user.role]}
                </span>

                {/* Activar / desactivar (no sobre uno mismo) */}
                {user.id !== profile?.id && (
                  <button
                    onClick={() => toggleStatus(user)}
                    style={{
                      marginLeft: '12px',
                      background: 'transparent',
                      border: '1px solid rgba(148, 163, 184, 0.4)',
                      color: '#cbd5e1',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    {user.status === 'active' ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        input::placeholder { color: #475569; }
        select option { background: #1e293b; color: #f1f5f9; }
      `}</style>
    </div>
  );
};

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'rgba(15, 23, 42, 0.8)',
  border: '1px solid rgba(71, 85, 105, 0.8)',
  borderRadius: '8px',
  padding: '10px 14px',
  color: '#f1f5f9',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
  transition: 'border-color 0.2s',
};
