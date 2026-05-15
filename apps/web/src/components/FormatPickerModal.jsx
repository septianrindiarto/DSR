import { useState } from "react";
import { FORMATS } from "../lib/dataFormats";

// Reusable popup that asks the user to pick a file format before either
// downloading (export) or opening the file picker (import).
//
// Usage:
//   <FormatPickerModal
//     mode="export"          // or "import"
//     defaultFormat="xlsx"
//     onCancel={() => setOpen(false)}
//     onConfirm={(format) => doExportOrImport(format)}
//   />
export default function FormatPickerModal({ mode = "export", defaultFormat = "xlsx", title, onCancel, onConfirm }) {
  const [selected, setSelected] = useState(defaultFormat);

  const headerTitle = title || (mode === "export" ? "Export Data" : "Import Data");
  const headerHint = mode === "export"
    ? "Pilih format file untuk diunduh"
    : "Pilih format file yang akan diunggah";
  const confirmLabel = mode === "export" ? "Export" : "Pilih File";
  const confirmIcon = mode === "export" ? "file_download" : "file_upload";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{headerTitle}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{headerHint}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 cursor-pointer"
            aria-label="Tutup"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-5 space-y-2">
          {FORMATS.map(f => {
            const checked = selected === f.key;
            return (
              <label
                key={f.key}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  checked
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="format"
                  value={f.key}
                  checked={checked}
                  onChange={() => setSelected(f.key)}
                  className="cursor-pointer"
                />
                <span className={`material-symbols-outlined text-[22px] ${checked ? "text-primary" : "text-slate-500"}`}>
                  {f.icon}
                </span>
                <span className="flex-1">
                  <span className="block text-sm font-medium text-slate-800">{f.label}</span>
                  <span className="block text-xs text-slate-500">.{f.ext}</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="flex gap-3 p-5 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 border border-slate-200 bg-white rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            className="flex-1 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:opacity-90 cursor-pointer flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[18px]">{confirmIcon}</span>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
