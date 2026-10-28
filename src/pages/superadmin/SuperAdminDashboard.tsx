import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { LogOut, Plus, Users } from 'lucide-react';
import clsx from 'clsx';
import { supabase } from '../../config/supabase';
import { useAuthStore } from '../../stores/useAuthStore';
import { callFunction } from '../../lib/callFunction';

interface RestaurantRow {
  id: string;
  name: string;
  identification: string | null;
  address: string | null;
  phone: string | null;
  status: 'active' | 'suspended';
  created_at: string;
  config: { service_fee_pct?: number } | null;
}

interface StaffRow {
  id: string;
  full_name: string;
  role: string;
  status: string;
  restaurant_id: string;
}

const EMPTY_FORM = {
  name: '',
  identification: '',
  address: '',
  phone: '',
  tables_count: '5',
  service_fee_pct: '10',
  admin_name: '',
  admin_email: '',
  admin_password: '',
};

const EMPTY_ADMIN_FORM = { full_name: '', email: '', password: '' };

const inputClass =
  'w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary';

const generatePassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
};

export const SuperAdminDashboard = () => {
  const { profile, logout } = useAuthStore();

  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [adminFor, setAdminFor] = useState<RestaurantRow | null>(null);
  const [adminForm, setAdminForm] = useState(EMPTY_ADMIN_FORM);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [r, p] = await Promise.all([
      supabase
        .from('restaurants')
        .select('id, name, identification, address, phone, status, created_at, config')
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id, full_name, role, status, restaurant_id')
        .not('restaurant_id', 'is', null),
    ]);

    if (r.error) setLoadError(r.error.message);
    else if (p.error) setLoadError(p.error.message);
    else {
      setLoadError(null);
      setRestaurants((r.data ?? []) as RestaurantRow[]);
      setStaff((p.data ?? []) as StaffRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const staffByRestaurant = useMemo(() => {
    const map = new Map<string, StaffRow[]>();
    for (const s of staff) {
      map.set(s.restaurant_id, [...(map.get(s.restaurant_id) ?? []), s]);
    }
    return map;
  }, [staff]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setNotice(null);
    setSubmitting(true);

    const { error } = await callFunction('create-restaurant', {
      ...form,
      tables_count: Number(form.tables_count),
      service_fee_pct: Number(form.service_fee_pct),
    });

    setSubmitting(false);
    if (error) {
      setFormError(error);
      return;
    }
    setNotice(`Restaurante "${form.name}" creado. Entrega al administrador su correo y contraseña.`);
    setForm(EMPTY_FORM);
    setShowForm(false);
    void load();
  };

  const handleToggleStatus = async (r: RestaurantRow) => {
    const next = r.status === 'active' ? 'suspended' : 'active';
    const question =
      next === 'suspended'
        ? `¿Suspender "${r.name}"? Todos sus usuarios perderán el acceso de inmediato.`
        : `¿Reactivar "${r.name}"?`;
    if (!window.confirm(question)) return;

    setBusyId(r.id);
    setNotice(null);
    const { error } = await supabase.rpc('set_restaurant_status', {
      p_restaurant_id: r.id,
      p_status: next,
    });
    setBusyId(null);

    if (error) {
      window.alert(error.message);
      return;
    }
    setRestaurants((cur) => cur.map((x) => (x.id === r.id ? { ...x, status: next } : x)));
  };

  const handleAddAdmin = async (e: FormEvent) => {
    e.preventDefault();
    if (!adminFor) return;
    setAdminError(null);
    setSubmitting(true);

    const { error } = await callFunction('create-user', {
      full_name: adminForm.full_name,
      email: adminForm.email,
      password: adminForm.password,
      role: 'admin',
      restaurant_id: adminFor.id,
    });

    setSubmitting(false);
    if (error) {
      setAdminError(error);
      return;
    }
    setNotice(`Administrador "${adminForm.full_name}" agregado a ${adminFor.name}.`);
    setAdminFor(null);
    setAdminForm(EMPTY_ADMIN_FORM);
    void load();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div>
            <h1 className="font-bold">Panel de plataforma</h1>
            <p className="text-xs text-slate-400">{profile?.full_name} · Superadmin</p>
          </div>
          <button
            onClick={logout}
            className="p-2 text-slate-300 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors"
            title="Cerrar sesión"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Restaurantes</h2>
            <p className="text-slate-500 text-sm">{restaurants.length} registrados</p>
          </div>
          <button
            onClick={() => {
              setShowForm(!showForm);
              setFormError(null);
              setNotice(null);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-xl font-medium transition-colors"
          >
            <Plus size={18} /> {showForm ? 'Cancelar' : 'Nuevo restaurante'}
          </button>
        </div>

        {notice && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm p-4">{notice}</div>
        )}
        {loadError && (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-4">{loadError}</div>
        )}

        {showForm && (
          <form onSubmit={handleCreate} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-6">
            <div>
              <h3 className="font-bold text-slate-800 mb-3">Datos del restaurante</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <input className={inputClass} required placeholder="Nombre *" value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input className={inputClass} placeholder="NIT / identificación" value={form.identification}
                  onChange={(e) => setForm({ ...form, identification: e.target.value })} />
                <input className={inputClass} placeholder="Dirección" value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })} />
                <input className={inputClass} placeholder="Teléfono" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <label className="text-xs text-slate-500">
                  Mesas iniciales (0–100)
                  <input className={clsx(inputClass, 'mt-1')} type="number" min={0} max={100} value={form.tables_count}
                    onChange={(e) => setForm({ ...form, tables_count: e.target.value })} />
                </label>
                <label className="text-xs text-slate-500">
                  Servicio / propina sugerida % (0 para desactivar)
                  <input className={clsx(inputClass, 'mt-1')} type="number" min={0} max={30} value={form.service_fee_pct}
                    onChange={(e) => setForm({ ...form, service_fee_pct: e.target.value })} />
                </label>
              </div>
            </div>

            <div>
              <h3 className="font-bold text-slate-800 mb-3">Administrador del restaurante</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <input className={inputClass} required placeholder="Nombre completo *" value={form.admin_name}
                  onChange={(e) => setForm({ ...form, admin_name: e.target.value })} />
                <input className={inputClass} required type="email" placeholder="Correo *" value={form.admin_email}
                  onChange={(e) => setForm({ ...form, admin_email: e.target.value })} />
                <div className="sm:col-span-2 flex gap-2">
                  <input className={inputClass} required minLength={8} placeholder="Contraseña (mínimo 8) *"
                    value={form.admin_password}
                    onChange={(e) => setForm({ ...form, admin_password: e.target.value })} />
                  <button type="button"
                    onClick={() => setForm({ ...form, admin_password: generatePassword() })}
                    className="px-4 rounded-xl border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap">
                    Generar
                  </button>
                </div>
              </div>
            </div>

            {formError && (
              <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm p-3">{formError}</div>
            )}

            <button type="submit" disabled={submitting}
              className="w-full py-3 bg-primary hover:bg-primary-dark text-white font-bold rounded-xl transition-colors disabled:opacity-50">
              {submitting ? 'Creando...' : 'Crear restaurante y administrador'}
            </button>
          </form>
        )}

        {loading ? (
          <p className="text-center text-slate-500 py-12">Cargando restaurantes...</p>
        ) : restaurants.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-white rounded-2xl border border-dashed border-slate-300">
            Aún no hay restaurantes. Crea el primero.
          </div>
        ) : (
          <div className="space-y-4">
            {restaurants.map((r) => {
              const people = staffByRestaurant.get(r.id) ?? [];
              const admins = people.filter((p) => p.role === 'admin');
              const suspended = r.status === 'suspended';
              return (
                <div key={r.id} className={clsx('bg-white rounded-2xl border shadow-sm p-5', suspended ? 'border-amber-300' : 'border-slate-200')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-800">{r.name}</h3>
                        <span className={clsx('text-xs font-semibold px-2 py-0.5 rounded-md',
                          suspended ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                          {suspended ? 'Suspendido' : 'Activo'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-500 mt-1">
                        {[r.identification, r.address, r.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                      </p>
                      <p className="text-sm text-slate-500 mt-1 flex items-center gap-1">
                        <Users size={14} /> {people.length} usuarios · creado {new Date(r.created_at).toLocaleDateString('es-CO')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setAdminFor(adminFor?.id === r.id ? null : r); setAdminError(null); setAdminForm(EMPTY_ADMIN_FORM); }}
                        className="px-3 py-2 text-sm font-medium rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50">
                        + Administrador
                      </button>
                      <button onClick={() => handleToggleStatus(r)} disabled={busyId === r.id}
                        className={clsx('px-3 py-2 text-sm font-medium rounded-xl border disabled:opacity-50',
                          suspended ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50' : 'border-amber-300 text-amber-700 hover:bg-amber-50')}>
                        {suspended ? 'Reactivar' : 'Suspender'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-slate-600">
                    <span className="font-medium">Administradores: </span>
                    {admins.length === 0
                      ? 'ninguno'
                      : admins.map((a) => a.full_name + (a.status === 'active' ? '' : ' (inactivo)')).join(', ')}
                  </div>

                  {adminFor?.id === r.id && (
                    <form onSubmit={handleAddAdmin} className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                      <div className="grid sm:grid-cols-3 gap-3">
                        <input className={inputClass} required placeholder="Nombre completo" value={adminForm.full_name}
                          onChange={(e) => setAdminForm({ ...adminForm, full_name: e.target.value })} />
                        <input className={inputClass} required type="email" placeholder="Correo" value={adminForm.email}
                          onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })} />
                        <div className="flex gap-2">
                          <input className={inputClass} required minLength={8} placeholder="Contraseña" value={adminForm.password}
                            onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })} />
                          <button type="button" onClick={() => setAdminForm({ ...adminForm, password: generatePassword() })}
                            className="px-3 rounded-xl border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">
                            Generar
                          </button>
                        </div>
                      </div>
                      {adminError && <p className="text-sm text-red-600">{adminError}</p>}
                      <button type="submit" disabled={submitting}
                        className="px-4 py-2 bg-primary hover:bg-primary-dark text-white text-sm font-medium rounded-xl disabled:opacity-50">
                        {submitting ? 'Creando...' : 'Agregar administrador'}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};
