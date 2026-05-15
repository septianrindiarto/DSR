/**
 * WhatsApp message builder service.
 * Generates formatted WhatsApp messages for order confirmations.
 */

const ADMIN_PHONE = process.env.ADMIN_WHATSAPP || '6282219812530';

export const whatsappService = {
    /**
     * Build a WhatsApp confirmation message URL for sending to customer.
     */
    buildConfirmationMessage(order) {
        const { customer, car, driver, orderNumber, pickupDate, returnDate, totalDays, totalPrice } = order;

        const formatDate = (d) => {
            const date = new Date(d);
            return date.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        };

        const formatPrice = (p) => `Rp ${Number(p).toLocaleString('id-ID')}`;

        let message = `✅ *KONFIRMASI PESANAN - DSR Solution*\n\n`;
        message += `📋 *No. Order:* ${orderNumber}\n\n`;
        message += `👤 *Data Pelanggan:*\n`;
        message += `• Nama: ${customer?.name || '-'}\n`;
        message += `• WhatsApp: ${customer?.whatsapp || customer?.phone || '-'}\n\n`;
        message += `🚗 *Data Kendaraan:*\n`;
        message += `• Mobil: ${car?.brand || ''} ${car?.name || '-'}\n`;
        message += `• Plat Nomor: ${car?.licensePlate || '-'}\n`;
        message += `• Warna: ${car?.color || '-'}\n\n`;

        if (driver) {
            message += `🧑‍✈️ *Data Driver:*\n`;
            message += `• Nama: ${driver.name}\n`;
            message += `• No. HP: ${driver.phone}\n`;
            message += `• No. SIM: ${driver.licenseNumber || '-'}\n\n`;
        }

        message += `📅 *Detail Sewa:*\n`;
        message += `• Tanggal Mulai: ${formatDate(pickupDate)}\n`;
        message += `• Tanggal Selesai: ${formatDate(returnDate)}\n`;
        message += `• Durasi: ${totalDays} hari\n`;
        message += `• Total Biaya: ${formatPrice(totalPrice)}\n\n`;
        message += `Terima kasih telah mempercayakan perjalanan Anda kepada DSR Solution! 🙏`;

        const customerPhone = (customer?.whatsapp || customer?.phone || '').replace(/[^0-9]/g, '');
        const phoneNumber = customerPhone.startsWith('0') ? '62' + customerPhone.substring(1) : customerPhone;

        return {
            url: `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`,
            message,
            phone: phoneNumber,
        };
    },

    /**
     * Build admin notification message for new order.
     */
    buildNewOrderNotification(order) {
        const { customer, car, orderNumber, pickupDate, returnDate, totalDays, totalPrice } = order;

        const formatDate = (d) => new Date(d).toLocaleDateString('id-ID');
        const formatPrice = (p) => `Rp ${Number(p).toLocaleString('id-ID')}`;

        let message = `🔔 *PESANAN BARU - DSR Solution*\n\n`;
        message += `No. Order: ${orderNumber}\n`;
        message += `Pelanggan: ${customer?.name || '-'}\n`;
        message += `Mobil: ${car?.brand || ''} ${car?.name || '-'}\n`;
        message += `Tanggal: ${formatDate(pickupDate)} - ${formatDate(returnDate)}\n`;
        message += `Durasi: ${totalDays} hari\n`;
        message += `Total: ${formatPrice(totalPrice)}\n\n`;
        message += `Silakan cek admin panel untuk konfirmasi.`;

        return {
            url: `https://wa.me/${ADMIN_PHONE}?text=${encodeURIComponent(message)}`,
            message,
        };
    },
};
