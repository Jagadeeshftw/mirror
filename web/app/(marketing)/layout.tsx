import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { MotionProvider } from "@/providers/motion-provider";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MotionProvider>
      <div className="landing-smooth bg-background text-foreground overflow-x-clip">
        <Navbar />
        <main id="content">{children}</main>
        <Footer />
      </div>
    </MotionProvider>
  );
}
