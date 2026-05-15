import Header from "../components/Header";
import HeroSection from "../components/HeroSection";
import CarGrid from "../components/CarGrid";
import FeaturesSection from "../components/FeaturesSection";
import PortfolioSection from "../components/PortfolioSection";
import CaseStudyBanner from "../components/CaseStudyBanner";
import Footer from "../components/Footer";

export default function LandingPage() {
  return (
    <div className="bg-background-light text-text-main min-h-screen flex flex-col relative">
      <CaseStudyBanner />
      <Header />
      <main className="flex-grow">
        <HeroSection />
        <CarGrid />
        <FeaturesSection />
        <PortfolioSection />
      </main>
      <Footer />
    </div>
  );
}
