"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import socket from "@/socket";

type User = {
  ip: string;
  pseudonym: string;
  connectedAt: number;
  pixelCount: number;
};

type AdminCommand = {
  command: string;
  url?: string;
};

const formatDuration = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  return `${minutes}m ${remSeconds}s`;
};

const UserList = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [selectedIp, setSelectedIp] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState<string>("");
  const searchParams = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token");
    if (token) {
      localStorage.setItem("adminToken", token);
    }

    const storedToken = localStorage.getItem("adminToken");
    if (storedToken) {
      setAdminToken(storedToken);
    }
  }, [searchParams]);

  useEffect(() => {
    socket.on("user-list", setUsers);

    socket.on("admin-command", (data: AdminCommand) => {
      if (data.command === "open-tab" && data.url) {
        window.open(data.url, "_blank");
      }
    });

    return () => {
      socket.off("user-list");
      socket.off("admin-command");
    };
  }, []);

  const toggleCommands = (ip: string) => {
    setSelectedIp((prev) => (prev === ip ? null : ip));
    setUrlInput(""); // reset input on toggle
  };

  const sendOpenTabCommand = (ip: string) => {
    if (!urlInput.trim()) return;
    socket.emit("admin-command", {
      ip,
      command: "open-tab",
      url: urlInput.trim(),
      adminToken,
    });
    setSelectedIp(null);
    setUrlInput("");
  };

  return (
    <div className="absolute top-3 left-3 z-10 pointer-events-auto">
      <div
        onClick={() => setOpen((prev) => !prev)}
        className="bg-white/80 backdrop-blur px-3 py-1 rounded-full shadow text-sm text-gray-800 cursor-pointer select-none"
      >
        {users.length} online
      </div>

      {open && (
        <div className="mt-2 max-h-64 overflow-y-auto bg-white/90 backdrop-blur rounded-lg shadow p-3 w-64 text-xs text-gray-700 absolute z-10">
          <ul className="space-y-2">
            {users.map((user) => (
              <li key={user.ip}>
                <div
                  onClick={() => adminToken && toggleCommands(user.ip)}
                  className={adminToken ? "cursor-pointer hover:underline" : ""}
                >
                  <strong>{user.pseudonym}</strong> —{" "}
                  {formatDuration(Date.now() - user.connectedAt)} —{" "}
                  {user.pixelCount} px
                </div>

                {adminToken && selectedIp === user.ip && (
                  <div className="mt-2 ml-2 space-y-1">
                    <input
                      type="text"
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      placeholder="https://example.com"
                      className="w-full border px-2 py-1 rounded text-xs"
                    />
                    <button
                      onClick={() => sendOpenTabCommand(user.ip)}
                      className="w-full text-left bg-blue-500 text-white hover:bg-blue-600 px-2 py-1 rounded"
                    >
                      Open Tab
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default UserList;
