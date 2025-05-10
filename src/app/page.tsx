"use client";

import dynamic from "next/dynamic";
import WelcomePopup from "@/app/components/WelcomePopup";
import ChatBox from "./components/ChatBox";

const PixelCanvas = dynamic(() => import("@/app/components/PixelCanvas"), {
  ssr: false,
});

export default function Home() {
  return (
    <>
      <PixelCanvas />
      <WelcomePopup />
      <ChatBox />
    </>
  );
}
