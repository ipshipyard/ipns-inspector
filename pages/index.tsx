// import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import IPNSInspector from "@/components/ipns-inspector";
import Footer from "@/components/footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export default function Home() {
  return (
    <div
      className={`${geistSans.variable} ${geistMono.variable} flex flex-col items-center justify-items-center min-h-screen p-4 pb-20 gap-2 sm:p-20 font-[family-name:var(--font-geist-sans)]`}
    >
      <IPNSInspector />      
      <Footer />
    </div>
  );
}
