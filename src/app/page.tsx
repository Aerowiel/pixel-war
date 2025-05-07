"use client";

import dynamic from "next/dynamic";
import RulesPopup from "@/app/components/RulesPopup";

const PixelCanvas = dynamic(() => import("@/app/components/PixelCanvas"), {
  ssr: false,
});

export default function Home() {
  return (
    <>
      <PixelCanvas />
      <RulesPopup />
    </>
  );
}
