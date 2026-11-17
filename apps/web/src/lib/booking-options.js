// Shared public booking options (landing form + interactive garage scene).
export const CAR_CATEGORIES = [
  { value: "MPV",      label: "MPV",      hint: "Contoh: Avanza, Xenia" },
  { value: "SUV",      label: "SUV",      hint: "Contoh: Innova, Fortuner" },
  { value: "City Car", label: "City Car", hint: "Contoh: Brio, Agya" },
  { value: "LCV",      label: "LCV",      hint: "Contoh: Hiace, Elf" },
  { value: "Pickup",   label: "Pickup",   hint: "Muatan kurang dari 1.5 Ton" },
  { value: "CDE",      label: "CDE",      hint: "Engkel, 2 sampai 3 Ton" },
  { value: "Lainnya",  label: "Lainnya",  hint: "Isi keterangan di kolom detail" },
];

export const PACKAGE_OPTIONS = ["All In", "Mobil dan Driver", "Lepas Kunci"];

// Public WhatsApp number (same as the floating WhatsApp button).
export const WA_NUMBER = "6282219812530";
export const waLink = (text) => `https://wa.me/${WA_NUMBER}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

// car.type (fleet enum) → public booking category.
export const typeToCategory = (type) => (["MPV", "SUV", "City Car"].includes(type) ? type : "Lainnya");
