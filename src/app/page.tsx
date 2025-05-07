"use client";

import dynamic from "next/dynamic";
const PixelCanvas = dynamic(() => import("@/app/components/PixelCanvas"), {
  ssr: false,
});

export default function Home() {
  return <PixelCanvas />;
}
