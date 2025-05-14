"use client";

import socket from "@/socket";
import { useEffect, useRef, useState } from "react";

type ChatMessage = { author: string; message: string };

const ChatBox = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleChatMessage = (chatMessage: ChatMessage) => {
      setMessages((prev) => [...prev.slice(-100), chatMessage]);
    };

    socket.on("chat-message", handleChatMessage);

    return () => {
      socket.off("chat-message", handleChatMessage);
    };
  }, []);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const sendMessage = () => {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      socket.emit("chat-message", trimmed);
      setInput("");
    }
  };

  return (
    <div className="fixed top-3 right-4 z-50">
      {open ? (
        <div className="bg-white border rounded-lg shadow w-64 h-[250px] flex flex-col">
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
              <div key={idx}>
                <strong>{msg.author}:</strong> {msg.message}
              </div>
            ))}
            <div ref={bottomRef} />
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
