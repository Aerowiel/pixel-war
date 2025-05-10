"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const WelcomePopup = () => {
  const [showPopup, setShowPopup] = useState(false);
  const [pseudo, setPseudo] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    const hasAccepted = localStorage.getItem("rulesAccepted");
    const hasSetPseudonyme = localStorage.getItem("pseudonym");
    if (!hasAccepted || !hasSetPseudonyme) {
      setShowPopup(true);
    }
  }, []);

  const handleAccept = () => {
    if (pseudo.trim().length === 0 || pseudo.trim().length > 15) {
      setError("Pseudonym must be 1–15 characters.");
      return;
    }

    localStorage.setItem("rulesAccepted", "true");
    localStorage.setItem("pseudonym", pseudo.trim());
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

        <input
          type="text"
          maxLength={15}
          placeholder="Enter your pseudonym"
          value={pseudo}
          onChange={(e) => setPseudo(e.target.value)}
          className="w-full px-3 py-2 mb-2 border border-gray-300 rounded-md text-sm"
        />
        {error && <div className="text-red-500 text-xs mb-2">{error}</div>}

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
