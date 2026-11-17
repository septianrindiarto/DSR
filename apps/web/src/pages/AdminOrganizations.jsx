import { Navigate } from "react-router-dom";

// Administrasi → Organisasi was merged into Manajemen Pengguna → Organisasi
// (components/OrganizationsPanel.jsx). Old links keep working.
export default function AdminOrganizations() {
  return <Navigate to="/admin/users?tab=orgs" replace />;
}
