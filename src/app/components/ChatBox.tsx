"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("/", { transports: ["websocket"] });

const ChatBox = () => {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [pseudonym, setPseudonym] = useState("Anonymous");

  useEffect(() => {
    const pseudo = localStorage.getItem("pseudonym");
    if (pseudo) setPseudonym(pseudo);

    socket.on("chat-message", (msg: string) => {
      console.log({ msg, messages });
      setMessages((prev) => [...prev.slice(-100), msg]);
    });

    return () => {
      socket.off("chat-message");
    };
  }, []);

  const sendMessage = () => {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      const fullMsg = `${pseudonym}: ${trimmed}`;
      socket.emit("chat-message", fullMsg);
      setInput("");
    }
  };

  return (
    <div className="fixed top-3 right-4 z-50">
      {open ? (
        <div className="bg-white border rounded-lg shadow w-64 max-h-64 flex flex-col">
          <div className="flex justify-between items-center px-2 py-1 border-b">
            <span className="text-sm font-semibold">Chat</span>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-gray-600 hover:text-black"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 text-xs text-gray-800">
            {messages.map((msg, idx) => (
              <div key={idx}>{msg}</div>
            ))}
          </div>
          <div className="flex border-t p-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              className="flex-1 px-2 py-1 text-xs border border-gray-300 rounded"
              placeholder="Type message..."
            />
            <button
              onClick={sendMessage}
              className="ml-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="bg-white border border-gray-400 rounded-full shadow px-3 py-1 text-xs hover:bg-gray-100"
        >
          Chat
        </button>
      )}
    </div>
  );
};

export default ChatBox;
