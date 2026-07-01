import Header from "../components/Header";
import HeroSection from "../components/HeroSection";
import FeaturesSection from "../components/FeaturesSection";
import PortfolioSection from "../components/PortfolioSection";
import Footer from "../components/Footer";
import LandingBookingForm from "../components/LandingBookingForm";
import { useAuth } from "../context/AuthContext";

// LandingPage
// Public homepage at "/".
//
// Layout (top to bottom):
//   CaseStudyBanner, Header, Hero, LandingBookingForm, Features,
//   PortfolioSection (demo accounts only), Footer.
//
// CarGrid ("Mobil Tersedia") used to live between the booking form and
// Features but has been removed per product request. PortfolioSection is
// kept but gated to demo accounts only so production clients do not see
// case-study content meant for sales walkthroughs.

export default function LandingPage() {
  const { user } = useAuth();
  const showPortfolio = Boolean(user?.isDemo);

  return (
    <div className="bg-background-light text-text-main min-h-screen flex flex-col relative">
      <Header />
      <main className="flex-grow">
        <HeroSection />
        {/* Public booking form anchored at #pesan so the Hero CTA and nav
            links can scroll directly into it. Placed BEFORE the rest of
            the page so visitors who already know what they want can book
            without scrolling past anything else. */}
        <LandingBookingForm />
        <FeaturesSection />
        {showPortfolio && <PortfolioSection />}
      </main>
      <Footer />
    </div>
  );
}
