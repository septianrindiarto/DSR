import { Link } from "react-router-dom";

export default function Header() {
  return (
    <header className="w-full bg-white border-b border-border-color sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo + Title */}
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <img
              src="/dsr-logo.png"
              alt="DSR Solution Logo"
              className="h-12 w-auto"
            />
            <h1 className="text-xl font-bold tracking-tight text-text-main">
              DSR <span className="text-primary">Solution</span>
            </h1>
          </Link>

          {/* Masuk Button */}
          <Link
            to="/admin/login"
            className="flex items-center justify-center h-10 px-6 rounded-lg bg-primary hover:bg-primary-dark text-white text-sm font-bold transition-colors shadow-md shadow-primary/20"
          >
            Masuk
          </Link>
        </div>
      </div>
    </header>
  );
}
