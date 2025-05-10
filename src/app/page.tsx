"use client";

import dynamic from "next/dynamic";
import ChatBox from "./components/ChatBox";

const PixelCanvas = dynamic(() => import("@/app/components/PixelCanvas"), {
  ssr: false,
});

const UserList = dynamic(() => import("@/app/components/UserList"), {
  ssr: false,
});

const WelcomePopup = dynamic(() => import("@/app/components/WelcomePopup"), {
  ssr: false,
});

export default function Home() {
  return (
    <>
      <PixelCanvas />
      <WelcomePopup />
      <ChatBox />
      <UserList />
    </>
  );
}
