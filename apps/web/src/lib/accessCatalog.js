// RBAC v2 — permission catalog for the access editor UI.
// Mirror of CATALOG in apps/api/src/services/access-core.js (keep in sync;
// the server is the authority and rejects anything not in its catalog).
export const CATALOG = {
  dashboard: ["view"],
  fleet: ["view", "create", "edit", "delete"],
  orders: ["view", "create", "edit", "delete", "claim", "export", "approve"],
  schedule: ["view"],
  customers: ["view", "create", "edit", "delete"],
  drivers: ["view", "create", "edit", "delete"],
  analytics: ["view"],
  finance: ["view", "create", "edit", "post", "lock"],
  documents: ["view", "create", "edit"],
  users: ["view", "create", "edit", "delete"],
  settings: ["view", "edit"],
  pricing: ["view", "edit"],
  corporate: ["view", "manage"],
  driverapp: ["use"],
  contracts: ["view", "create", "edit"],
  opsrecap: ["view", "create", "edit", "verify", "approve"],
};

export const FEATURE_LABEL = {
  dashboard: "Dashboard", fleet: "Armada", orders: "Rekap Order", schedule: "Jadwal",
  customers: "Pelanggan", drivers: "Driver", analytics: "Analitik", finance: "Keuangan",
  documents: "Dokumen & Invoice", users: "Pengguna", settings: "Pengaturan",
  pricing: "Tarif", corporate: "Portal Perusahaan", driverapp: "Aplikasi Driver", contracts: "Kontrak",
  opsrecap: "Rekap Operasional & Lembur",
};

export const ACTIONS = ["view", "create", "edit", "delete", "claim", "export", "approve", "verify", "post", "lock", "manage", "use"];
export const ACTION_LABEL = {
  view: "Lihat", create: "Tambah", edit: "Ubah", delete: "Hapus",
  claim: "Klaim", export: "Export", post: "Posting", lock: "Kunci",
  approve: "Setujui", verify: "Verifikasi", manage: "Kelola", use: "Pakai",
};
