export default function WhatsAppFAB() {
    return (
        <a
            aria-label="Hubungi kami di WhatsApp"
            className="fixed bottom-6 right-6 z-[60] w-16 h-16 bg-whatsapp text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform duration-300 group"
            href="https://wa.me/6281234567890"
            rel="noopener noreferrer"
            target="_blank"
        >
            <svg
                className="w-9 h-9 fill-current"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path d="M17.472 14.382c-.301-.15-1.781-.878-2.057-.978-.277-.1-.478-.15-.679.15-.201.301-.778 1-.954 1.15-.176.15-.353.17-.654.02-1.203-.6-2.115-1.075-2.957-2.522-.222-.381.222-.354.635-1.173.067-.135.034-.254-.017-.354-.051-.1-.478-1.151-.654-1.576-.171-.413-.343-.357-.478-.364-.124-.006-.266-.007-.409-.007s-.374.054-.57.266c-.197.213-.751.734-.751 1.79s.768 2.079.875 2.222c.107.143 1.51 2.305 3.657 3.23.511.22 1.055.352 1.411.41.511.094.976.081 1.343.027.41-.061 1.258-.514 1.436-1.011.178-.497.178-.923.124-1.011-.054-.088-.201-.141-.502-.291zm-5.419 4.318h-.001c-1.321 0-2.618-.356-3.744-1.029l-.268-.159-2.783.73 0.743-2.713-.174-.277c-.739-1.177-1.13-2.541-1.13-3.945 0-4.14 3.369-7.509 7.512-7.509 2.006 0 3.893.782 5.31 2.199s2.199 3.304 2.199 5.31c0 4.141-3.369 7.51-7.512 7.51zm9.333-12.822c-1.848-1.85-4.305-2.87-6.918-2.87-5.388 0-9.773 4.385-9.773 9.774 0 1.723.451 3.405 1.307 4.888L2 22l5.539-1.453c1.432.781 3.048 1.192 4.693 1.193h0.004c5.385 0 9.773-4.387 9.773-9.775 0-2.611-1.017-5.068-2.867-6.918z" />
            </svg>
            <span className="absolute right-full mr-3 bg-gray-800 text-white text-xs py-1 px-3 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
                Chat via WhatsApp
            </span>
        </a>
    );
}
