import { useState, lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LanguageProvider, useLanguage } from "./context/LanguageContext";
import { canAccess, FEATURES, isDriverOnly } from "./lib/permissions";
import RequestAccessModal from "./components/RequestAccessModal";
import ApiActivityBar from "./components/ApiActivityBar";
import LandingPage from "./pages/LandingPage";
import AdminLogin from "./pages/AdminLogin";
// Admin pages are code-split: each loads its own chunk on first visit, so the
// public landing bundle stays small and heavy pages (Dokumen, Rekap, Keuangan)
// show a spinner instead of a blank screen while they load.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminFleet = lazy(() => import("./pages/AdminFleet"));
const AdminOrders = lazy(() => import("./pages/AdminOrders"));
const AdminSchedule = lazy(() => import("./pages/AdminSchedule"));
const AdminCustomers = lazy(() => import("./pages/AdminCustomers"));
const AdminDrivers = lazy(() => import("./pages/AdminDrivers"));
const AdminAnalytics = lazy(() => import("./pages/AdminAnalytics"));
const AdminFinance = lazy(() => import("./pages/AdminFinance"));
const AdminDocuments = lazy(() => import("./pages/AdminDocuments"));
const AdminSettings = lazy(() => import("./pages/AdminSettings"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const AdminAccessRequests = lazy(() => import("./pages/AdminAccessRequests"));
const AdminClaimOrders = lazy(() => import("./pages/AdminClaimOrders"));
const AdminOrganizations = lazy(() => import("./pages/AdminOrganizations"));
const AdminPricing = lazy(() => import("./pages/AdminPricing"));
const DriverApp = lazy(() => import("./pages/DriverApp"));
const AdminFleetCare = lazy(() => import("./pages/AdminFleetCare"));
// Interactive one-screen landing (trial at /v2 while the classic page stays at /).
const LandingScene = lazy(() => import("./pages/LandingScene"));
const AdminContractHub = lazy(() => import("./pages/AdminContractHub"));
const AdminReports = lazy(() => import("./pages/AdminReports"));

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-[#f8f5f5]">
      <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
    </div>
  );
}
import VerifyEmail from "./pages/VerifyEmail";
import CarDetail from "./pages/CarDetail";
import NotFound from "./pages/NotFound";
import WhatsAppFAB from "./components/WhatsAppFAB";
import { ToastProvider } from "./components/Toast";
import SessionGuard from "./components/SessionGuard";

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

  // Driver accounts only have the driver app.
  if (isDriverOnly(user) && feature !== FEATURES.DRIVERAPP) return <Navigate to="/driver" replace />;
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

// Superadmin-only gate (org management). Backend routes are the authoritative
// check; this keeps the URL bar honest.
function SuperadminRoute({ children }) {
  const { user } = useAuth();
  if (user?.role !== "superadmin") return <Navigate to="/admin/dashboard" replace />;
  return children;
}

function App() {
  return (
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <ToastProvider>
          {/* Top loading bar while any request is running (saves show at once). */}
          <ApiActivityBar />
          {/* 15-minute idle timeout: warning, keep-alive, expired flag (owner 2026-11-13). */}
          <SessionGuard />
          {/* WhatsApp FAB visible on ALL pages */}
          <WhatsAppFAB />
          <Suspense fallback={<PageSpinner />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/v2" element={<LandingScene />} />
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
            <Route path="/admin/pricing" element={<Guarded feature={FEATURES.PRICING}><AdminPricing /></Guarded>} />
            <Route path="/admin/corporate" element={<Navigate to="/admin/reports" replace />} />
            <Route path="/admin/reports" element={<Guarded feature={FEATURES.REPORTS}><AdminReports /></Guarded>} />
            <Route path="/driver" element={<Guarded feature={FEATURES.DRIVERAPP}><DriverApp /></Guarded>} />
            <Route path="/admin/contracts" element={<Guarded feature={FEATURES.CONTRACTHUB}><AdminContractHub /></Guarded>} />
            <Route path="/admin/fleet-care" element={<Guarded feature={FEATURES.FLEETCARE}><AdminFleetCare /></Guarded>} />
            <Route path="/admin/ops-recap" element={<Navigate to="/admin/contracts?tab=ops" replace />} />
            <Route path="/admin/users" element={<Guarded feature={FEATURES.USERS}><AdminUsers /></Guarded>} />
            <Route path="/admin/access-requests" element={<Guarded feature={FEATURES.USERS}><AdminAccessRequests /></Guarded>} />
            <Route path="/admin/claim-orders" element={<Guarded feature={FEATURES.ACCESS_REQUESTS}><AdminClaimOrders /></Guarded>} />
            <Route path="/admin/organizations" element={<ProtectedRoute><SuperadminRoute><AdminOrganizations /></SuperadminRoute></ProtectedRoute>} />
            <Route path="/car/:id" element={<CarDetail />} />
            {/* Audit C-02: catch-all 404. Must remain LAST so it does not
                shadow the routes above. */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  );
}

export default App;
