// Simulate the frontend date range calculation
function getDateRange(currentDate, view) {
    const d = new Date(currentDate);
    if (view === "week") {
        const day = d.getDay();
        const start = new Date(d);
        start.setDate(d.getDate() - day + 1);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        return { start, end };
    } else {
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        return { start, end };
    }
}

// Current date: April 30 2026
const now = new Date(2026, 3, 30); // April 30
const { start, end } = getDateRange(now, "month");

console.log("View: month");
console.log("Start:", start.toISOString(), "→ local:", start.toString());
console.log("End:  ", end.toISOString(), "→ local:", end.toString());
console.log("");

// C058 dates
const c058pickup = new Date("2026-04-29T17:00:00.000Z");
const c058return = new Date("2026-04-29T17:00:00.000Z");

console.log("C058 pickup:", c058pickup.toISOString(), "→ local:", c058pickup.toString());
console.log("C058 return:", c058return.toISOString(), "→ local:", c058return.toString());
console.log("");

// Backend filter: pickupDate <= end AND returnDate >= start
console.log("Backend filter check:");
console.log("  pickupDate <= endDate?", c058pickup <= end, `(${c058pickup.toISOString()} <= ${end.toISOString()})`);
console.log("  returnDate >= startDate?", c058return >= start, `(${c058return.toISOString()} >= ${start.toISOString()})`);
console.log("");

// Frontend isBookingOnDay check for April 30
const day30 = new Date(2026, 3, 30); // April 30
console.log("isBookingOnDay check for April 30:");
const bStart = new Date(c058pickup);
const bEnd = new Date(c058return);
bStart.setHours(0, 0, 0, 0);
bEnd.setHours(23, 59, 59, 999);
const d = new Date(day30);
d.setHours(12, 0, 0, 0);
console.log("  booking start (floored):", bStart.toISOString(), "→", bStart.toString());
console.log("  booking end (ceiled):  ", bEnd.toISOString(), "→", bEnd.toString());
console.log("  day (noon):            ", d.toISOString(), "→", d.toString());
console.log("  d >= bStart?", d >= bStart);
console.log("  d <= bEnd?", d <= bEnd);
console.log("  VISIBLE?", d >= bStart && d <= bEnd);
