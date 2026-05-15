import { Link } from "react-router-dom";

// Slim banner that sits above the Hero — signals to visiting clients that
// this is a real working system they can poke around in, not a static demo.
export default function CaseStudyBanner() {
    return (
        <div className="bg-slate-900 text-white text-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-400 text-slate-900 text-[10px] font-black uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[12px]">workspace_premium</span>
                    Portfolio Case Study
                </span>
                <span className="text-slate-200">
                    Aplikasi manajemen rental nyata, lengkap dengan admin panel.
                </span>
                <Link
                    to="/admin/login"
                    className="inline-flex items-center gap-1 font-bold text-amber-300 hover:text-amber-200 transition-colors group"
                >
                    View Admin Demo
                    <span className="material-symbols-outlined text-[16px] group-hover:translate-x-0.5 transition-transform">
                        arrow_forward
                    </span>
                </Link>
            </div>
        </div>
    );
}
