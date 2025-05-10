import React, { useRef, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useSearchParams } from "next/navigation";
import {
  COLOR_PALETTE,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  MIN_SCALE,
  MAX_SCALE,
  INITIAL_SCALE,
} from "../../../lib/constants";

// Constants
const GRID_SCALE_THRESHOLD = 10;
const DEFAULT_SELECTED_COLOR = COLOR_PALETTE[0];

// Utility Functions
const hexToABGR = (hex: string): number => {
  hex = hex.replace(/^#/, "");
  const rgb = parseInt(hex, 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (255 << 24) | (b << 16) | (g << 8) | r; // ABGR
};

// Types
interface PixelCoord {
  x: number;
  y: number;
}

const PixelCanvas: React.FC = () => {
  // Refs
  const socketRef = useRef<Socket | null>(null);
  const requestAnimationFrameRef = useRef<number>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pixelsRef = useRef<Map<string, string>>(new Map());
  const hoverPixelRef = useRef<PixelCoord | null>(null);
  const selectedColorRef = useRef<string>(DEFAULT_SELECTED_COLOR);
  const imageDataRef = useRef<ImageData | null>(null);
  const imageUint32Ref = useRef<Uint32Array | null>(null);
  const scaleRef = useRef<number>(INITIAL_SCALE);
  const offsetRef = useRef<PixelCoord>({ x: 0, y: 0 });
  const isDraggingRef = useRef<boolean>(false);
  const hasDraggedRef = useRef<boolean>(false);
  const dragStartRef = useRef<PixelCoord>({ x: 0, y: 0 });
  const lastTouchDistanceRef = useRef<number | null>(null);
  const lastTouchMidpointRef = useRef<PixelCoord | null>(null);
  const isTouchDeviceRef = useRef<boolean>(false);
  const isMouseDownRef = useRef<boolean>(false);

  const offscreenCanvas = document.createElement("canvas");
  offscreenCanvas.width = CANVAS_WIDTH;
  offscreenCanvas.height = CANVAS_HEIGHT;
  const offscreenCtx = offscreenCanvas.getContext("2d")!;

  // States
  const [selectedColor, setSelectedColor] = useState<string>(
    DEFAULT_SELECTED_COLOR
  );
  const [displayScale, setDisplayScale] = useState<number>(INITIAL_SCALE);
  const [cooldown, setCooldown] = useState<{
    remaining: number;
    total: number;
  }>({
    remaining: 0,
    total: 0,
  });
  const [centerCoord, setCenterCoord] = useState<PixelCoord>({ x: 0, y: 0 });
  const [userCount, setUserCount] = useState<number>(0);

  // Admin
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Hooks
  const searchParams = useSearchParams();

  // Initialization Effects

  /* Draw loop */
  useEffect(() => {
    requestAnimationFrameRef.current = requestAnimationFrame(drawCanvas);
    return () => {
      if (requestAnimationFrameRef.current) {
        cancelAnimationFrame(requestAnimationFrameRef.current);
      }
    };
  }, []);

  /* Socket */
  useEffect(() => {
    const socket = io("/", { transports: ["websocket"] });
    socketRef.current = socket;

    socket.on("pixel-placed", handlePixelPlaced);

    socket.on("canvas-state", handleCanvasState);

    socket.on("cooldown", handleCooldown);

    socket.on("user-count", (count: number) => {
      setUserCount(count);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(setupInitialCanvasPosition, []);

  useEffect(handleCooldownInternal, [cooldown.remaining]);

  useEffect(() => {
    selectedColorRef.current = selectedColor;
  }, [selectedColor]);

  useEffect(setupEventListeners, []);

  useEffect(checkIfAdmin, []);

  // Socket event handlers
  const handlePixelPlaced = ({
    x,
    y,
    color,
  }: {
    x: number;
    y: number;
    color: string;
  }) => {
    const key = `${x}:${y}`;
    pixelsRef.current.set(key, color);

    const index = y * CANVAS_WIDTH + x;
    const abgr = hexToABGR(color);

    if (imageUint32Ref.current && imageDataRef.current) {
      imageUint32Ref.current[index] = abgr;
      offscreenCtx.putImageData(imageDataRef.current, 0, 0);
    } else {
      // fallback if image buffer not initialized
      renderPixelsToOffscreen();
    }
  };

  const handleCanvasState = (canvas: Record<string, string>) => {
    const newMap = new Map<string, string>(Object.entries(canvas));
    pixelsRef.current = newMap;
    renderPixelsToOffscreen();
  };

  const handleCooldown = ({
    remaining,
    total,
  }: {
    remaining: number;
    total: number;
  }) => {
    setCooldown({ remaining, total });
  };

  // Draw methods
  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.save();

    // Reset transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#f1f1f1";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply pan and zoom
    ctx.setTransform(
      scaleRef.current,
      0,
      0,
      scaleRef.current,
      offsetRef.current.x,
      offsetRef.current.y
    );

    // White background
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Prevent blurry image
    ctx.imageSmoothingEnabled = false;

    // Draw pre-rendered pixels
    ctx.drawImage(offscreenCanvas, 0, 0);

    // Grid and hover pixel overlays
    drawHoverPixel(ctx);
    drawGrid(ctx);

    ctx.restore();

    requestAnimationFrame(drawCanvas);
  };

  const renderPixelsToOffscreen = () => {
    const imageData = offscreenCtx.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
    const uint32View = new Uint32Array(imageData.data.buffer);

    pixelsRef.current.forEach((color, key) => {
      const [x, y] = key.split(":").map(Number);
      const index = y * CANVAS_WIDTH + x;
      uint32View[index] = hexToABGR(color);
    });

    imageDataRef.current = imageData;
    imageUint32Ref.current = uint32View;

    offscreenCtx.putImageData(imageData, 0, 0);
  };

  const handleEmitPixel = (x: number, y: number) => {
    if (cooldown.remaining > 0) return;

    if (x < 0 || y < 0 || x >= CANVAS_WIDTH || y >= CANVAS_HEIGHT) return;

    socketRef.current?.emit("place-pixel", {
      x,
      y,
      color: selectedColor,
      isAdmin,
    });
  };

  const drawHoverPixel = (ctx: CanvasRenderingContext2D) => {
    if (!hoverPixelRef.current || isTouchDeviceRef.current) return;
    const hoverPixel = hoverPixelRef.current;

    ctx.strokeStyle = selectedColorRef.current;
    ctx.lineWidth = 1 / scaleRef.current;
    ctx.strokeRect(hoverPixel.x, hoverPixel.y, 1, 1);
    ctx.fillStyle = selectedColorRef.current + "33";
    ctx.fillRect(hoverPixel.x, hoverPixel.y, 1, 1);
  };

  const drawGrid = (ctx: CanvasRenderingContext2D) => {
    if (scaleRef.current < GRID_SCALE_THRESHOLD) return;

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

  // Events handlers
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
    updateUrlWithCoordinates();
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0 && isAdmin) {
      isMouseDownRef.current = true;
    }
    /* If right click */
    if (e.button === 2) {
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = true;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isTouchDeviceRef.current = false;

    const [x, y] = getCoordinatesFromMouseEvent(e);

    if (!isDraggingRef.current) {
      if (isMouseDownRef.current && isAdmin) {
        handleEmitPixel(x, y);
      }

      hoverPixelRef.current =
        x >= 0 && y >= 0 && x < CANVAS_WIDTH && y < CANVAS_HEIGHT
          ? { x, y }
          : null;
    } else {
      offsetRef.current.x += e.clientX - dragStartRef.current.x;
      offsetRef.current.y += e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0 && isAdmin) {
      isMouseDownRef.current = false;
    }

    isDraggingRef.current = false;
    updateUrlWithCoordinates();
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement, MouseEvent>) => {
    const [x, y] = getCoordinatesFromMouseEvent(e);

    handleEmitPixel(x, y);
  };

  const handleTouchStart = (e: TouchEvent) => {
    isTouchDeviceRef.current = true;

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
    }

    if (e.touches.length === 2) {
      e.preventDefault();
      hasDraggedRef.current = true;

      const touches = Array.from(e.touches);
      const [t1, t2] = touches;
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
      }

      lastTouchDistanceRef.current = distance;
      lastTouchMidpointRef.current = midpoint;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
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

  // Utils

  const getCoordinatesFromMouseEvent = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const x = Math.floor((mouseX - offsetRef.current.x) / scaleRef.current);
    const y = Math.floor((mouseY - offsetRef.current.y) / scaleRef.current);

    return [x, y];
  };
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

  const updateScale = (newScale: number) => {
    scaleRef.current = newScale;
    setDisplayScale(newScale);
  };

  function setupInitialCanvasPosition() {
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
  }

  function handleCooldownInternal() {
    if (cooldown.remaining <= 0) return;

    const interval = setInterval(() => {
      setCooldown((prev) => ({
        ...prev,
        remaining: Math.max(prev.remaining - 100, 0),
      }));
    }, 100);

    return () => clearInterval(interval);
  }

  function checkIfAdmin() {
    const _isAdmin = parseInt(searchParams.get("ia") || "");

    setIsAdmin(_isAdmin === 1 ? true : false);
  }

  function setupEventListeners() {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }

  return (
    <div className="w-screen h-screen overflow-hidden relative">
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
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-crosshair"
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
};

export default PixelCanvas;
