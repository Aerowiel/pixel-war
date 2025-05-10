"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import socket from "@/socket";

const WelcomePopup = () => {
  const [showPopup, setShowPopup] = useState(true);

  const [pseudo, setPseudo] = useState(localStorage.getItem("pseudonym") || "");
  const [error, setError] = useState("");
  const router = useRouter();

  const handleAccept = () => {
    const trimmed = pseudo.trim();
    if (trimmed.length === 0 || trimmed.length > 15) {
      setError("Pseudonym must be 1–15 characters.");
      return;
    }

    localStorage.setItem("rulesAccepted", "true");
    localStorage.setItem("pseudonym", trimmed);

    socket.emit("set-pseudonym", trimmed); // Send to server

    setShowPopup(false);
  };

  const handleDecline = () => {
    router.replace("https://youtu.be/dQw4w9WgXcQ");
  };

  if (!showPopup) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-white rounded-2xl p-6 sm:p-8 w-full max-w-md sm:max-w-lg text-center shadow-xl">
        <h2 className="text-lg sm:text-xl font-semibold mb-4">
          🧱 The Pixel War Pact
        </h2>
        <p className="mb-4 text-sm sm:text-base text-gray-700">
          Before joining the canvas chaos, agree to these sacred pixel laws:
        </p>
        <ul className="text-left list-disc list-inside mb-4 text-sm sm:text-base text-gray-700 space-y-1">
          <li>🚫 No swastikas</li>
          <li>🧍 Be excellent to each other</li>
          <li>💀 Don't grief — build cool stuff instead</li>
        </ul>

        <div className="text-left w-full mb-3">
          <label
            htmlFor="pseudonym"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Pseudonym
          </label>
          <input
            id="pseudonym"
            type="text"
            maxLength={15}
            placeholder="Enter your pseudonym"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            autoFocus
          />
          {error && <div className="text-red-500 text-xs mt-1">{error}</div>}
        </div>

        <div className="flex flex-col sm:flex-row justify-center gap-3">
          <button
            onClick={handleAccept}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition text-sm sm:text-base"
          >
            I solemnly swear not to draw swastikas
          </button>
          <button
            onClick={handleDecline}
            className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 transition text-sm sm:text-base"
          >
            I'm a menace to pixel society
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomePopup;
