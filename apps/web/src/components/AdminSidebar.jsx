import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import { visibleNavFor, FEATURES, canAccess } from "../lib/permissions";

export default function AdminSidebar({ mobileMenuOpen, onClose }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang, toggleLanguage } = useLanguage();
  const { user, logout } = useAuth();

  // Desktop collapse (icon-rail). Persisted. On the mobile overlay we always
  // show the full sidebar, so `collapsedNow` ignores the flag when the mobile
  // menu is open.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("dsr:sidebar:collapsed") === "1"; } catch { return false; }
  });
  const toggleCollapse = () => setCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem("dsr:sidebar:collapsed", next ? "1" : "0"); } catch { /* ignore */ }
    return next;
  });
  const collapsedNow = collapsed && !mobileMenuOpen;

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
  if (user?.role === 'superadmin') adminNavItems.push({ label: t('organizationsMenu'), icon: "corporate_fare", path: "/admin/organizations" });

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/admin/login');
    } catch (error) {
      navigate('/admin/login');
    }
  };

  // Shared nav-link renderer (collapses to an icon with a tooltip).
  const NavLink = ({ path, icon, label }) => {
    const isActive = location.pathname === path;
    return (
      <Link
        key={path}
        to={path}
        onClick={onClose}
        title={collapsedNow ? label : undefined}
        className={`flex items-center gap-3 py-3 rounded-lg transition-all group ${collapsedNow ? "justify-center px-0" : "px-4"} ${
          isActive ? "bg-primary text-white shadow-lg shadow-primary/20" : "hover:bg-sidebar-hover text-neutral-400 hover:text-white"
        }`}
      >
        <span className={`material-symbols-outlined text-[22px] ${!isActive ? "group-hover:text-primary transition-colors" : ""}`}>
          {icon}
        </span>
        {!collapsedNow && <span className="text-sm font-medium whitespace-nowrap">{label}</span>}
      </Link>
    );
  };

  const SectionHeader = ({ children }) =>
    collapsedNow ? <div className="my-2 mx-3 border-t border-neutral-800" /> : (
      <div className="mt-6 px-4 mb-2 text-xs font-semibold text-neutral-600 uppercase tracking-wider">{children}</div>
    );

  return (
    <>
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 bg-black/50 z-10 md:hidden" onClick={onClose}></div>
      )}

      {/* Sidebar */}
      <aside
        className={`${collapsedNow ? "md:w-20" : "md:w-64"} w-64 flex-shrink-0 flex flex-col h-screen bg-sidebar-dark text-sidebar-text border-r border-neutral-800 transition-all duration-300 z-20 ${
          mobileMenuOpen ? "fixed inset-y-0 left-0" : "hidden"
        } md:flex md:relative`}
      >
        {/* Scrollable region: logo + nav. Scrollbar hidden (no-scrollbar) but
            scrolling still works; min-h-0 lets it shrink so the bottom section
            stays visible. */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          {/* Logo + collapse toggle */}
          <div className="h-20 flex items-center border-b border-neutral-800 px-3">
            {!collapsedNow && (
              <Link to="/admin/dashboard" onClick={onClose} className="flex items-center gap-3 hover:opacity-80 transition-opacity min-w-0 flex-1">
                <img src="/dsr-logo.png" alt="DSR Solution" className="h-10 w-auto flex-shrink-0" />
                <div className="flex flex-col min-w-0">
                  <h1 className="text-white text-lg font-bold tracking-tight truncate">DSR Solution</h1>
                  <p className="text-xs text-neutral-500 font-medium truncate">{t('adminPanel')}</p>
                </div>
              </Link>
            )}
            {/* Collapse toggle — desktop only */}
            <button
              onClick={toggleCollapse}
              title={collapsedNow ? t('expandMenu') : t('collapseMenu')}
              className={`hidden md:flex items-center justify-center h-9 w-9 rounded-lg text-neutral-400 hover:text-white hover:bg-sidebar-hover cursor-pointer ${collapsedNow ? "mx-auto" : "ml-auto"}`}
            >
              <span className="material-symbols-outlined text-[22px]">{collapsedNow ? "chevron_right" : "chevron_left"}</span>
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex flex-col gap-1 p-3">
            <SectionHeader>{t('mainMenu')}</SectionHeader>
            {navItems.map((item) => <NavLink key={item.path} path={item.path} icon={item.icon} label={item.label} />)}

            {adminNavItems.length > 0 && (
              <>
                <SectionHeader>{t('administration')}</SectionHeader>
                {adminNavItems.map((item) => <NavLink key={item.path} path={item.path} icon={item.icon} label={item.label} />)}
              </>
            )}

            {canSeeSettings && (
              <>
                <SectionHeader>{t('account')}</SectionHeader>
                <NavLink path="/admin/settings" icon="settings" label={t('settings')} />
              </>
            )}
          </nav>
        </div>

        {/* Bottom Section: Language Toggle + User + Logout. */}
        <div className="flex-shrink-0 p-3 border-t border-neutral-800 space-y-2">
          <button
            onClick={toggleLanguage}
            title={collapsedNow ? (lang === 'id' ? 'Indonesia' : 'English') : undefined}
            className={`w-full flex items-center gap-3 py-2.5 rounded-lg hover:bg-sidebar-hover text-neutral-400 hover:text-white transition-colors cursor-pointer ${collapsedNow ? "justify-center px-0" : "px-4"}`}
          >
            <span className="material-symbols-outlined text-[22px]">translate</span>
            {!collapsedNow && <span className="text-sm font-medium">{lang === 'id' ? '🇮🇩 Indonesia' : '🇬🇧 English'}</span>}
            {!collapsedNow && <span className="ml-auto text-xs bg-neutral-700 px-2 py-0.5 rounded text-neutral-300 uppercase">{lang}</span>}
          </button>

          {/* User Profile */}
          <div className={`flex items-center gap-3 py-2 ${collapsedNow ? "justify-center px-0" : "px-4"}`} title={collapsedNow ? (user?.name || 'Admin') : undefined}>
            <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold flex-shrink-0">
              {user?.name?.[0]?.toUpperCase() || 'A'}
            </div>
            {!collapsedNow && (
              <div className="flex flex-col overflow-hidden">
                <span className="text-sm font-medium text-white truncate">{user?.name || 'Admin'}</span>
                <span className="text-xs text-neutral-500 truncate">{user?.email || 'admin@dsrsolution.com'}</span>
              </div>
            )}
          </div>

          <button
            onClick={handleLogout}
            title={collapsedNow ? t('logout') : undefined}
            className={`w-full flex items-center gap-3 py-3 rounded-lg hover:bg-red-900/20 text-neutral-400 hover:text-primary transition-colors group cursor-pointer ${collapsedNow ? "justify-center px-0" : "px-4"}`}
          >
            <span className="material-symbols-outlined text-[22px]">logout</span>
            {!collapsedNow && <span className="text-sm font-medium">{t('logout')}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}
