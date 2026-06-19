import { useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LanguageProvider, useLanguage } from "./context/LanguageContext";
import { canAccess, FEATURES } from "./lib/permissions";
import RequestAccessModal from "./components/RequestAccessModal";
import LandingPage from "./pages/LandingPage";
import AdminLogin from "./pages/AdminLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AdminFleet from "./pages/AdminFleet";
import AdminOrders from "./pages/AdminOrders";
import AdminSchedule from "./pages/AdminSchedule";
import AdminCustomers from "./pages/AdminCustomers";
import AdminDrivers from "./pages/AdminDrivers";
import AdminAnalytics from "./pages/AdminAnalytics";
import AdminFinance from "./pages/AdminFinance";
import AdminDocuments from "./pages/AdminDocuments";
import AdminSettings from "./pages/AdminSettings";
import AdminUsers from "./pages/AdminUsers";
import AdminAccessRequests from "./pages/AdminAccessRequests";
import VerifyEmail from "./pages/VerifyEmail";
import CarDetail from "./pages/CarDetail";
import NotFound from "./pages/NotFound";
import WhatsAppFAB from "./components/WhatsAppFAB";
import { ToastProvider } from "./components/Toast";

function ProtectedRoute({ children }) {
  const { user, loading, sessionExpired } = useAuth();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#f8f5f5]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 text-sm">{t('loading')}</p>
        </div>
      </div>
    );
  }

  // Audit M-05: when the 401 interceptor flips sessionExpired, the user
  // object is also cleared. The Navigate below kicks in immediately, and
  // AdminLogin reads the same flag to render the banner.
  if (!user) {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}

// RoleGate — second guard layer applied INSIDE ProtectedRoute. Checks whether
// the current user's role is allowed to see this `feature`. If not, the user
// sees the "Request Access" modal (Phase 3) and is bounced to /admin/orders
// when they close it.
// Backend route guards are the AUTHORITATIVE check; this just keeps the URL
// bar honest so a curious client typing /admin/fleet doesn't see a flashed
// page before the API 403 fires.
function RoleGate({ feature, children }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [showRequestModal, setShowRequestModal] = useState(true);

  if (!canAccess(user, feature)) {
    return (
      <div className="min-h-screen bg-[#f8f5f5]">
        {showRequestModal && (
          <RequestAccessModal
            featureKey={feature}
            featureLabel={t(feature)}
            onClose={() => {
              setShowRequestModal(false);
              navigate("/admin/orders", { replace: true });
            }}
            onSuccess={() => {
              setShowRequestModal(false);
              navigate("/admin/orders", { replace: true });
            }}
          />
        )}
      </div>
    );
  }
  return children;
}

// Small helper to keep route declarations short and readable.
function Guarded({ feature, children }) {
  return (
    <ProtectedRoute>
      <RoleGate feature={feature}>{children}</RoleGate>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <ToastProvider>
          {/* WhatsApp FAB visible on ALL pages */}
          <WhatsAppFAB />
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/admin/dashboard" element={<Guarded feature={FEATURES.DASHBOARD}><AdminDashboard /></Guarded>} />
            <Route path="/admin/fleet" element={<Guarded feature={FEATURES.FLEET}><AdminFleet /></Guarded>} />
            <Route path="/admin/orders" element={<Guarded feature={FEATURES.ORDERS}><AdminOrders /></Guarded>} />
            <Route path="/admin/schedule" element={<Guarded feature={FEATURES.SCHEDULE}><AdminSchedule /></Guarded>} />
            <Route path="/admin/customers" element={<Guarded feature={FEATURES.CUSTOMERS}><AdminCustomers /></Guarded>} />
            <Route path="/admin/drivers" element={<Guarded feature={FEATURES.DRIVERS}><AdminDrivers /></Guarded>} />
            <Route path="/admin/analytics" element={<Guarded feature={FEATURES.ANALYTICS}><AdminAnalytics /></Guarded>} />
            <Route path="/admin/finance" element={<Guarded feature={FEATURES.FINANCE}><AdminFinance /></Guarded>} />
            <Route path="/admin/documents" element={<Guarded feature={FEATURES.DOCUMENTS}><AdminDocuments /></Guarded>} />
            <Route path="/admin/settings" element={<Guarded feature={FEATURES.SETTINGS}><AdminSettings /></Guarded>} />
            <Route path="/admin/users" element={<Guarded feature={FEATURES.USERS}><AdminUsers /></Guarded>} />
            <Route path="/admin/access-requests" element={<Guarded feature={FEATURES.USERS}><AdminAccessRequests /></Guarded>} />
            <Route path="/car/:id" element={<CarDetail />} />
            {/* Audit C-02: catch-all 404. Must remain LAST so it does not
                shadow the routes above. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  );
}

export default App;
