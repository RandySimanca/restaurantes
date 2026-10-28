import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore, type Role } from '../stores/useAuthStore';

export const homeFor = (role: Role) => `/${role}`;

/** Deja pasar solo a los roles indicados. La seguridad real está en RLS; esto es UX. */
export const RequireRole = ({ roles, children }: { roles: Role[]; children: ReactNode }) => {
  const { user, profile } = useAuthStore();

  if (!user) return <Navigate to="/login" replace />;
  if (!profile) return null; // AuthWrapper ya muestra el error de perfil
  if (!roles.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;

  return <>{children}</>;
};
