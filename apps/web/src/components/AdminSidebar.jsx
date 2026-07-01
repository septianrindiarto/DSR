import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { visibleNavFor, FEATURES, canAccess } from "../lib/permissions";

export default function AdminSidebar({ mobileMenuOpen, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, toggleLanguage } = useLanguage();
  const { user, logout } = useAuth();

  // `key` must match a FEATURES value so permissions can gate the item.
  const allNavItems = [
    { key: FEATURES.DASHBOARD, label: t('dashboard'), icon: "dashboard", path: "/admin/dashboard" },
    { key: FEATURES.FLEET, label: t('fleet'), icon: "directions_car", path: "/admin/fleet" },
    { key: FEATURES.ORDERS, label: t('orderRecap'), icon: "receipt_long", path: "/admin/orders" },
    { key: FEATURES.SCHEDULE, label: t('schedule'), icon: "calendar_month", path: "/admin/schedule" },
    { key: FEATURES.CUSTOMERS, label: t('customers'), icon: "group", path: "/admin/customers" },
    { key: FEATURES.DRIVERS, label: t('drivers'), icon: "badge", path: "/admin/drivers" },
    { key: FEATURES.ANALYTICS, label: t('analytics'), icon: "analytics", path: "/admin/analytics" },
    { key: FEATURES.FINANCE, label: t('finance'), icon: "payments", path: "/admin/finance" },
    { key: FEATURES.DOCUMENTS, label: t('documents'), icon: "description", path: "/admin/documents" },
  ];

  // Permission gates — single source of truth is canAccess(user, feature)
  // which considers accountType + role + per-user grants.
  const navItems = visibleNavFor(user, allNavItems);
  const canSeeSettings = canAccess(user, FEATURES.SETTINGS);
  const canSeeUsers = canAccess(user, FEATURES.USERS);
  const canSeeAccessRequests = canAccess(user, FEATURES.ACCESS_REQUESTS);

  // Admin items — visible to both agency admins AND client admins.
  const adminNavItems = [];
  if (canSeeUsers) adminNavItems.push({ label: t('userManagement'), icon: "manage_accounts", path: "/admin/users" });
  if (canSeeAccessRequests) adminNavItems.push({ label: t('claimOrders'), icon: "how_to_reg", path: "/admin/claim-orders" });

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
        className={`w-64 flex-shrink-0 flex flex-col h-screen bg-sidebar-dark text-sidebar-text border-r border-neutral-800 transition-all duration-300 z-20 ${
          mobileMenuOpen ? "fixed inset-y-0 left-0" : "hidden"
        } md:flex md:relative`}
      >
        {/* Scrollable region: logo + nav. min-h-0 lets it shrink so the
            bottom section stays visible and this area scrolls instead of
            pushing the logout button off-screen. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Logo Area */}
          <div className="h-20 flex items-center px-6 border-b border-neutral-800 gap-3">
            {/* Logo links to /admin/dashboard so navigating from inside the
                admin panel keeps the user in the authenticated context.
                Public landing page is reachable via direct URL / from the
                user menu. This was the root cause of the "I got logged out"
                report — clicking the logo dumped users onto the public
                landing page where the Masuk button made them re-login. */}
            <Link
              to="/admin/dashboard"
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
                  {t('adminPanel')}
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
                  {t('administration')}
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

            {canSeeSettings && (
              <>
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
              </>
            )}
          </nav>
        </div>

        {/* Bottom Section: Language Toggle + User + Logout.
            flex-shrink-0 pins it so it never gets squeezed/pushed off-screen. */}
        <div className="flex-shrink-0 p-4 border-t border-neutral-800 space-y-2">
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
            <div className="flex flex-col overflow-hidden"><span className="text-sm font-medium text-white truncate">
                {user?.name || 'Admin'}
              </span>
              <span className="text-xs text-neutral-500 truncate">
                {user?.email || 'admin@dsrsolution.com'}
              </span>
            </div>
          </div>

          {/* Logout button. Calls handleLogout which clears the session
              cookie via the API then navigates back to /admin/login. */}
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
