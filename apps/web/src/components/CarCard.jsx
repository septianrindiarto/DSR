import { Link } from "react-router-dom";

const API_BASE = 'http://localhost:5000';
const carImgSrc = (url) => url?.startsWith('/uploads') ? `${API_BASE}${url}` : url;

export default function CarCard({ car }) {
  const features = typeof car.features === 'string' ? JSON.parse(car.features) : (car.features || []);

  const formatPrice = (p) => {
    const num = Number(p);
    if (num >= 1000000) return `Rp${num / 1000000}jt`;
    if (num >= 1000) return `Rp${(num / 1000).toFixed(0)}rb`;
    return `Rp${num}`;
  };

  const currentPrice = car.price || 0;
  const maxPrice = car.maxPrice;
  const priceDisplay = maxPrice && currentPrice !== maxPrice
    ? `${formatPrice(currentPrice)} - ${formatPrice(maxPrice)}`
    : formatPrice(currentPrice);

  const categoryLabels = { economy: "Ekonomi", standard: "Standar", premium: "Premium", luxury: "Mewah" };

  return (
    <div className="group bg-white rounded-xl shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border border-gray-100 overflow-hidden flex flex-col">
      {/* Image */}
      <div className="relative aspect-[4/3] overflow-hidden bg-gray-100">
        <img
          alt={car.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          src={carImgSrc(car.image)}
          loading="lazy"
          decoding="async"
        />
        {car.category && (
          <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs font-bold text-slate-700 shadow-sm capitalize">
            {categoryLabels[car.category] || car.category}
          </div>
        )}
        {car.type && (
          <div className="absolute top-3 right-3 bg-primary/90 backdrop-blur-sm px-2.5 py-1 rounded-full text-xs font-bold text-white shadow-sm">
            {car.type}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-grow">
        <div className="flex justify-between items-start mb-2">
          <div>
            <p className="text-xs font-medium text-text-sub uppercase tracking-wider mb-1">
              {car.brand}
            </p>
            <h3 className="text-xl font-bold text-text-main">{car.name}</h3>
            {car.availableCount > 0 ? (
              <div className="mt-2 text-[10px] font-bold uppercase tracking-wider bg-green-50 text-green-600 px-2.5 py-1 rounded-sm w-fit">
                Tersedia {car.availableCount} Mobil
              </div>
            ) : (
              <div className="mt-2 text-[10px] font-bold uppercase tracking-wider bg-orange-50 text-orange-600 px-2.5 py-1 rounded-sm w-fit">
                Sedang Disewa
              </div>
            )}
          </div>
          <div className="flex flex-col items-end">
            <span className="text-lg font-bold text-primary">{priceDisplay}</span>
            <span className="text-xs text-gray-400">/ hari</span>
          </div>
        </div>

        <div className="flex items-center gap-4 py-4 border-t border-dashed border-gray-200 mt-2 mb-4">
          <div className="flex items-center gap-1 text-gray-500 text-[13px]">
            <span className="material-symbols-outlined text-[18px]">person</span>
            <span>{car.capacity} Kursi</span>
          </div>
          <div className="flex items-center gap-1 text-gray-500 text-[13px]">
            <span className="material-symbols-outlined text-[18px]">settings</span>
            <span>{car.transmission === 'Automatic' ? 'Auto' : 'Manual'}</span>
          </div>
          <div className="flex items-center gap-1 text-gray-500 text-[13px]">
            <span className="material-symbols-outlined text-[18px]">local_gas_station</span>
            <span>{car.fuel || 'Bensin'}</span>
          </div>
        </div>

        {/* CTA */}
        <Link
          to={`/car/${car.id}`}
          className="w-full mt-auto py-2.5 rounded-lg bg-primary text-white font-medium hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 group-hover:shadow-lg group-hover:shadow-primary/20"
        >
          Pesan Sekarang
        </Link>
      </div>
    </div>
  );
}