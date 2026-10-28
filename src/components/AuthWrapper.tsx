import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * Arranca la escucha de sesión una sola vez y bloquea el render hasta saber
 * quién es el usuario. La navegación por rol vive en App.tsx / RequireRole.
 */
export const AuthWrapper = ({ children }: { children: ReactNode }) => {
  const { init, loading, user, profileError, logout } = useAuthStore();

  useEffect(() => init(), [init]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        Cargando...
      </div>
    );
  }

  if (user && profileError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
        <p className="max-w-md text-slate-700">{profileError}</p>
        <button
          onClick={logout}
          className="px-5 py-3 rounded-xl bg-primary text-white font-medium hover:bg-primary-dark transition-colors"
        >
          Cerrar sesión
        </button>
      </div>
    );
  }

  return <>{children}</>;
};
