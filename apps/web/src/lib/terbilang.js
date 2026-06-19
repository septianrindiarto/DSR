// Indonesian number-to-words helper (terbilang).
// Extracted from AdminDocuments.jsx as the first step of audit C-01
// decomposition. Pure function, no React, no localStorage. Safe to import
// from anywhere.
//
//   import { terbilang } from "../lib/terbilang";
//   terbilang(1500000) // -> "Satu Juta Lima Ratus Ribu Rupiah"
//   terbilang(0)       // -> "Nol Rupiah"

const SATUAN = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan"];
const BELASAN = ["Sepuluh", "Sebelas", "Dua Belas", "Tiga Belas", "Empat Belas",
  "Lima Belas", "Enam Belas", "Tujuh Belas", "Delapan Belas", "Sembilan Belas"];

function _ratusan(n) {
  if (n === 0) return "";
  if (n < 10) return SATUAN[n];
  if (n < 20) return BELASAN[n - 10];
  if (n < 100) {
    const r = n % 10;
    return SATUAN[Math.floor(n / 10)] + " Puluh" + (r ? " " + SATUAN[r] : "");
  }
  const r = n % 100;
  const pre = Math.floor(n / 100) === 1 ? "Se" : SATUAN[Math.floor(n / 100)] + " ";
  return pre + "Ratus" + (r ? " " + _ratusan(r) : "");
}

function _convert(n) {
  if (n === 0) return "";
  if (n < 1000) return _ratusan(n);
  if (n < 1000000) {
    const r = n % 1000;
    const pre = Math.floor(n / 1000) === 1 ? "Se" : _ratusan(Math.floor(n / 1000)) + " ";
    return pre + "Ribu" + (r ? " " + _convert(r) : "");
  }
  if (n < 1000000000) {
    const r = n % 1000000;
    return _ratusan(Math.floor(n / 1000000)) + " Juta" + (r ? " " + _convert(r) : "");
  }
  const r = n % 1000000000;
  return _ratusan(Math.floor(n / 1000000000)) + " Milyar" + (r ? " " + _convert(r) : "");
}

export function terbilang(amount) {
  const n = Math.round(Number(amount || 0));
  if (n === 0) return "Nol Rupiah";
  return _convert(n).trim() + " Rupiah";
}

export default terbilang;
