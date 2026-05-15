import { useState } from "react";
import AdminSidebar from "./AdminSidebar";

export default function AdminLayout({ children, title, subtitle }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f8f5f5] font-[Inter,sans-serif] text-slate-900 antialiased">
      <AdminSidebar
        mobileMenuOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#f8f5f5] relative">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center justify-between p-4 bg-white border-b border-neutral-200">
          <div className="flex items-center gap-3">
            <img
              src="/dsr-logo.png"
              alt="DSR Solution"
              className="h-8 w-auto"
            />
            <span className="font-bold text-slate-900">DSR Solution</span>
          </div>
          <button
            className="p-2 text-slate-500 hover:text-primary cursor-pointer"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        </header>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 lg:px-12">
          <div className="max-w-7xl mx-auto space-y-8">
            {children}

            {/* Footer */}
            <footer className="pt-8 text-center text-xs text-slate-400 pb-4">
              <p>© 2026 DSR Solution Admin Panel. Seluruh hak dilindungi.</p>
            </footer>
          </div>
        </div>
      </main>
    </div>
  );
}
