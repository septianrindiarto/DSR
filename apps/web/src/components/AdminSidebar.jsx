import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";

export default function AdminSidebar({ mobileMenuOpen, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, toggleLanguage } = useLanguage();
  const { user, logout } = useAuth();

  const isSuperAdmin = user?.role === 'superadmin';
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const navItems = [
    { label: t('dashboard'), icon: "dashboard", path: "/admin/dashboard" },
    { label: t('fleet'), icon: "directions_car", path: "/admin/fleet" },
    { label: t('orderRecap'), icon: "receipt_long", path: "/admin/orders" },
    { label: t('schedule'), icon: "calendar_month", path: "/admin/schedule" },
    { label: t('customers'), icon: "group", path: "/admin/customers" },
    { label: t('drivers'), icon: "badge", path: "/admin/drivers" },
    { label: t('analytics'), icon: "analytics", path: "/admin/analytics" },
    { label: t('finance'), icon: "payments", path: "/admin/finance" },
    { label: t('documents'), icon: "description", path: "/admin/documents" },
  ].filter(Boolean);

  // Admin-only items appended after main nav
  const adminNavItems = isAdmin ? [
    { label: 'Manajemen Pengguna', icon: "manage_accounts", path: "/admin/users" },
  ] : [];

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/admin/login');
    } catch (error) {
      navigate('/admin/login');
    }
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-10 md:hidden"
          onClick={onClose}
        ></div>
      )}

      {/* Sidebar */}
      <aside
        className={`w-64 flex-shrink-0 flex flex-col justify-between bg-sidebar-dark text-sidebar-text border-r border-neutral-800 transition-all duration-300 z-20 ${
          mobileMenuOpen ? "fixed inset-y-0 left-0" : "hidden"
        } md:flex md:relative`}
      >
        <div>
          {/* Logo Area */}
          <div className="h-20 flex items-center px-6 border-b border-neutral-800 gap-3">
            <Link
              to="/"
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <img
                src="/dsr-logo.png"
                alt="DSR Solution"
                className="h-10 w-auto"
              />
              <div className="flex flex-col">
                <h1 className="text-white text-lg font-bold tracking-tight">
                  DSR Solution
                </h1>
                <p className="text-xs text-neutral-500 font-medium">
                  Panel Admin
                </p>
              </div>
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex flex-col gap-1 p-4">
            <div className="px-4 mb-2 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
              {t('mainMenu')}
            </div>
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                    isActive
                      ? "bg-primary text-white shadow-lg shadow-primary/20"
                      : "hover:bg-sidebar-hover text-neutral-400 hover:text-white"
                  }`}
                >
                  <span className={`material-symbols-outlined text-[22px] ${!isActive ? "group-hover:text-primary transition-colors" : ""}`}>
                    {item.icon}
                  </span>
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}

            {adminNavItems.length > 0 && (
              <>
                <div className="mt-6 px-4 mb-2 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                  Administrasi
                </div>
                {adminNavItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                        isActive
                          ? "bg-primary text-white shadow-lg shadow-primary/20"
                          : "hover:bg-sidebar-hover text-neutral-400 hover:text-white"
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[22px] ${!isActive ? "group-hover:text-primary transition-colors" : ""}`}>
                        {item.icon}
                      </span>
                      <span className="text-sm font-medium">{item.label}</span>
                    </Link>
                  );
                })}
              </>
            )}

            <div className="mt-6 px-4 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
              {t('account')}
            </div>
            <Link
              to="/admin/settings"
              onClick={onClose}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all group ${
                location.pathname === "/admin/settings"
                  ? "bg-primary text-white shadow-lg shadow-primary/20"
                  : "hover:bg-sidebar-hover text-neutral-400 hover:text-white"
              }`}
            >
              <span className={`material-symbols-outlined text-[22px] ${location.pathname === "/admin/settings" ? "" : "group-hover:text-primary transition-colors"}`}>
                settings
              </span>
              <span className="text-sm font-medium">{t('settings')}</span>
            </Link>
          </nav>
        </div>

        {/* Bottom Section: Language Toggle + User + Logout */}
        <div className="p-4 border-t border-neutral-800 space-y-2">
          {/* Language Toggle */}
          <button
            onClick={toggleLanguage}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-sidebar-hover text-neutral-400 hover:text-white transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[22px]">translate</span>
            <span className="text-sm font-medium">{lang === 'id' ? '🇮🇩 Indonesia' : '🇬🇧 English'}</span>
            <span className="ml-auto text-xs bg-neutral-700 px-2 py-0.5 rounded text-neutral-300 uppercase">{lang}</span>
          </button>

          {/* User Profile */}
          <div className="flex items-center gap-3 px-4 py-2">
            <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold">
              {user?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium text-white truncate">
                {user?.name || 'Admin'}
              </span>
              <span className="text-xs text-neutral-500 truncate">
                {user?.email || 'admin@dsrsolution.com'}
              </span>
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-red-900/20 text-neutral-400 hover:text-primary transition-colors group cursor-pointer"
          >
            <span className="material-symbols-outlined text-[22px]">logout</span>
            <span className="text-sm font-medium">{t('logout')}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
