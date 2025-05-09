import React, { useRef, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import {
  COLOR_PALETTE,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  MIN_SCALE,
  MAX_SCALE,
  INITIAL_SCALE,
} from "../../../lib/constants";

import { useSearchParams } from "next/navigation";

const GRID_SCALE_THRESHOLD = 10;

interface PixelCoord {
  x: number;
  y: number;
}

function hexToRgb(hex: string) {
  const shorthand = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthand, (_, r, g, b) => r + r + g + g + b + b);

  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return match
    ? {
        r: parseInt(match[1], 16),
        g: parseInt(match[2], 16),
        b: parseInt(match[3], 16),
      }
    : { r: 0, g: 0, b: 0 };
}

const PixelCanvas: React.FC = () => {
  const socketRef = useRef<Socket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const bufferCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [selectedColor, setSelectedColor] = useState<string>("#000000");
  const [displayScale, setDisplayScale] = useState<number>(INITIAL_SCALE);
  const [hoverPixel, setHoverPixel] = useState<PixelCoord | null>(null);
  const [cooldown, setCooldown] = useState<{
    remaining: number;
    total: number;
  }>({
    remaining: 0,
    total: 0,
  });
  const [centerCoord, setCenterCoord] = useState<PixelCoord>({ x: 0, y: 0 });

  const scaleRef = useRef<number>(INITIAL_SCALE);
  const offsetRef = useRef<PixelCoord>({ x: 0, y: 0 });
  const isDraggingRef = useRef<boolean>(false);
  const hasDraggedRef = useRef<boolean>(false);
  const dragStartRef = useRef<PixelCoord>({ x: 0, y: 0 });

  const lastTouchDistanceRef = useRef<number | null>(null);
  const lastTouchMidpointRef = useRef<PixelCoord | null>(null);
  const isTouchDevice = useRef<boolean>(false);

  const searchParams = useSearchParams();

  const [userCount, setUserCount] = useState<number>(0);

  const updateUrlWithCoordinates = () => {
    const centerX = Math.floor(
      (window.innerWidth / 2 - offsetRef.current.x) / scaleRef.current
    );
    const centerY = Math.floor(
      (window.innerHeight / 2 - offsetRef.current.y) / scaleRef.current
    );
    const zoom = Math.round(scaleRef.current * 100) / 100;

    const params = new URLSearchParams();
    params.set("x", centerX.toString());
    params.set("y", centerY.toString());
    params.set("z", zoom.toString());

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl); // ✅ no reload, no GET

    setCenterCoord({ x: centerX, y: centerY });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    if (!imageDataRef.current) {
      const buffer = new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
      imageDataRef.current = buffer;
    }

    const socket = io("/");
    socketRef.current = socket;

    socket.on("canvas-state", (pixels: Record<string, string>) => {
      for (const [key, color] of Object.entries(pixels)) {
        const [x, y] = key.split(":").map(Number);
        setPixelInBuffer(x, y, color);
      }
      drawCanvas();
    });

    socket.on("pixel-placed", ({ x, y, color }) => {
      setPixelInBuffer(x, y, color);
      drawCanvas();
    });

    socket.on("cooldown", setCooldown);
    socket.on("user-count", setUserCount);

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const x = parseInt(searchParams.get("x") || "");
    const y = parseInt(searchParams.get("y") || "");
    const zoom = parseFloat(searchParams.get("z") || "");

    const isValidCoord = (val: number) =>
      typeof val === "number" && !isNaN(val);

    if (isValidCoord(x) && isValidCoord(y) && x >= 0 && y >= 0) {
      setCenterCoord({ x, y });

      const scale =
        zoom >= MIN_SCALE && zoom <= MAX_SCALE ? zoom : INITIAL_SCALE;
      updateScale(scale);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      offsetRef.current = {
        x: centerX - x * scale,
        y: centerY - y * scale,
      };
    } else {
      const centerCanvas = () => {
        const canvas = canvasRef.current;

        if (!canvas) return;
        updateScale(INITIAL_SCALE);

        offsetRef.current = {
          x: (canvas.width - CANVAS_WIDTH * INITIAL_SCALE) / 2,
          y: (canvas.height - CANVAS_HEIGHT * INITIAL_SCALE) / 2,
        };
      };

      centerCanvas(); // fallback
    }

    drawCanvas();
  }, []);

  useEffect(() => {
    if (cooldown.remaining <= 0) return;

    const interval = setInterval(() => {
      setCooldown((prev) => ({
        ...prev,
        remaining: Math.max(prev.remaining - 100, 0),
      }));
    }, 100);

    return () => clearInterval(interval);
  }, [cooldown.remaining]);

  const updateScale = (newScale: number) => {
    scaleRef.current = newScale;
    setDisplayScale(newScale);
  };

  const setPixelInBuffer = (x: number, y: number, color: string) => {
    if (!imageDataRef.current) return;
    const index = (y * CANVAS_WIDTH + x) * 4;
    const { r, g, b } = hexToRgb(color);
    const data = imageDataRef.current.data;
    data[index] = r;
    data[index + 1] = g;
    data[index + 2] = b;
    data[index + 3] = 255;
  };

  const drawHoverPixel = (ctx: CanvasRenderingContext2D) => {
    if (!hoverPixel || isTouchDevice.current) return;
    ctx.strokeStyle = selectedColor;
    ctx.lineWidth = 1 / scaleRef.current;
    ctx.strokeRect(hoverPixel.x, hoverPixel.y, 1, 1);
    ctx.fillStyle = selectedColor + "33";
    ctx.fillRect(hoverPixel.x, hoverPixel.y, 1, 1);
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || !imageDataRef.current) return;

    console.log("draw canvas");

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(
      scaleRef.current,
      0,
      0,
      scaleRef.current,
      offsetRef.current.x,
      offsetRef.current.y
    );

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.putImageData(imageDataRef.current, 0, 0);
    drawHoverPixel(ctx);
    // drawGrid(ctx);
    ctx.restore();
  };

  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    //if (scaleRef.current < GRID_SCALE_THRESHOLD) return;

    ctx.beginPath();
    ctx.strokeStyle = "#cccccc"; // light gray
    ctx.lineWidth = 1 / scaleRef.current;

    // Vertical lines
    for (let x = 0; x <= CANVAS_WIDTH; x++) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
    }

    // Horizontal lines
    for (let y = 0; y <= CANVAS_HEIGHT; y++) {
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
    }

    ctx.stroke();
  };

  useEffect(() => {
    drawCanvas();
  }, [hoverPixel, displayScale]);

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();

    const rect = canvasRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const currentScale = scaleRef.current;
    const newScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, currentScale * scaleFactor)
    );

    const worldX = (mouseX - offsetRef.current.x) / currentScale;
    const worldY = (mouseY - offsetRef.current.y) / currentScale;

    offsetRef.current.x = mouseX - worldX * newScale;
    offsetRef.current.y = mouseY - worldY * newScale;

    updateScale(newScale);
    drawCanvas();
  };

  const handleMouseDown = (e: MouseEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current) return;

    offsetRef.current.x += e.clientX - dragStartRef.current.x;
    offsetRef.current.y += e.clientY - dragStartRef.current.y;
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    drawCanvas();
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement, MouseEvent>) => {
    if (cooldown.remaining > 0 || hasDraggedRef.current) return;

    const rect = canvasRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const x = Math.floor((mouseX - offsetRef.current.x) / scaleRef.current);
    const y = Math.floor((mouseY - offsetRef.current.y) / scaleRef.current);

    if (x < 0 || y < 0 || x >= CANVAS_WIDTH || y >= CANVAS_HEIGHT) return;

    socketRef.current?.emit("place-pixel", {
      x,
      y,
      color: selectedColor,
    });
  };

  const handleTouchStart = (e: TouchEvent) => {
    isTouchDevice.current = true;

    if (e.touches.length === 1) {
      isDraggingRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (e.touches.length === 1 && isDraggingRef.current) {
      e.preventDefault();
      const touch = e.touches[0];
      offsetRef.current.x += touch.clientX - dragStartRef.current.x;
      offsetRef.current.y += touch.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: touch.clientX, y: touch.clientY };
      hasDraggedRef.current = true;
      drawCanvas();
    }

    if (e.touches.length === 2) {
      e.preventDefault();
      const [t1, t2] = e.touches;
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const distance = Math.hypot(dx, dy);

      const midpoint = {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
      };

      if (lastTouchDistanceRef.current !== null) {
        const delta = distance / lastTouchDistanceRef.current;
        const currentScale = scaleRef.current;
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, currentScale * delta)
        );

        const worldX = (midpoint.x - offsetRef.current.x) / currentScale;
        const worldY = (midpoint.y - offsetRef.current.y) / currentScale;

        offsetRef.current.x = midpoint.x - worldX * newScale;
        offsetRef.current.y = midpoint.y - worldY * newScale;

        updateScale(newScale);
        drawCanvas();
      }

      lastTouchDistanceRef.current = distance;
      lastTouchMidpointRef.current = midpoint;
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    isDraggingRef.current = false;
    lastTouchDistanceRef.current = null;
    lastTouchMidpointRef.current = null;

    updateUrlWithCoordinates();

    if (cooldown.remaining > 0 || hasDraggedRef.current) return;

    const touch = e.changedTouches[0];
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor(
      (touch.clientX - rect.left - offsetRef.current.x) / scaleRef.current
    );
    const y = Math.floor(
      (touch.clientY - rect.top - offsetRef.current.y) / scaleRef.current
    );

    if (x < 0 || y < 0 || x >= CANVAS_WIDTH || y >= CANVAS_HEIGHT) return;

    socketRef.current?.emit("place-pixel", {
      x,
      y,
      color: selectedColor,
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("wheel", handleWheel);
    canvas.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd);

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      drawCanvas();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
    };
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden relative">
      {/* Connected Users (Top-Left) */}
      <div className="absolute top-3 left-3 z-10 pointer-events-auto">
        <div className="bg-white/80 backdrop-blur px-3 py-1 rounded-full shadow text-sm text-gray-800">
          {userCount} online
        </div>
      </div>
      <div className="absolute top-3 left-1/2 transform -translate-x-1/2 z-10 pointer-events-auto">
        <div className="flex items-center bg-white/80 backdrop-blur px-4 py-2 rounded-full shadow text-sm font-medium">
          {`(${centerCoord.x}, ${centerCoord.y}) ${
            Math.round(displayScale * 100) / 100
          }x`}
        </div>
      </div>
      {/* Bottom UI */}
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-0 right-0 z-10 pointer-events-auto px-4 flex justify-center">
        <div className="w-fit flex flex-col items-center gap-2 bg-white/80 backdrop-blur-md px-4 py-3 rounded-xl shadow">
          {/* Cooldown Bar */}
          {cooldown.remaining > 0 && (
            <div className="w-full h-2 bg-gray-300 rounded overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all duration-100 ease-linear"
                style={{
                  width:
                    cooldown.total > 0
                      ? `${Math.max(
                          0,
                          (cooldown.remaining / cooldown.total) * 100
                        )}%`
                      : "0%",
                }}
              />
            </div>
          )}

          {/* Color Palette */}
          <div className="flex flex-wrap justify-center gap-2 w-full">
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className={`w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 cursor-pointer border ${
                  selectedColor === color
                    ? "border-black border-2"
                    : "border-gray-300"
                }`}
                style={{ backgroundColor: color }}
                aria-label={`Select color ${color}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div>
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-crosshair"
          onClick={handleClick}
        />
      </div>
    </div>
  );
};

export default PixelCanvas;
