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

const GRID_SCALE_THRESHOLD = 10;

interface PixelCoord {
  x: number;
  y: number;
}

const PixelCanvas: React.FC = () => {
  const socketRef = useRef<Socket | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pixels, setPixels] = useState<Map<string, string>>(() => new Map());
  const pixelsRef = useRef(pixels);

  const [selectedColor, setSelectedColor] = useState<string>("#000000");
  const [displayScale, setDisplayScale] = useState<number>(INITIAL_SCALE);
  const [hoverPixel, setHoverPixel] = useState<PixelCoord | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);

  const scaleRef = useRef<number>(INITIAL_SCALE);
  const offsetRef = useRef<PixelCoord>({ x: 0, y: 0 });
  const isDraggingRef = useRef<boolean>(false);
  const hasDraggedRef = useRef<boolean>(false);
  const dragStartRef = useRef<PixelCoord>({ x: 0, y: 0 });

  const lastTouchDistanceRef = useRef<number | null>(null);
  const lastTouchMidpointRef = useRef<PixelCoord | null>(null);

  useEffect(() => {
    const socket = io("/", { transports: ["websocket"] }); // or io("http://localhost:3000") if custom URL
    socketRef.current = socket;

    // When another user places a pixel
    socket.on(
      "pixel-placed",
      ({ x, y, color }: { x: number; y: number; color: string }) => {
        const key = `${x}:${y}`;
        setPixels((prev) => {
          const newMap = new Map(prev);
          newMap.set(key, color);
          return newMap;
        });
      }
    );

    socket.on("canvas-state", (canvas: Record<string, string>) => {
      const newMap = new Map<string, string>(Object.entries(canvas));
      setPixels(newMap);
    });

    socket.on("cooldown", ({ remaining }: { remaining: number }) => {
      setCooldownRemaining(remaining);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (cooldownRemaining <= 0) return;

    const interval = setInterval(() => {
      setCooldownRemaining((prev) => Math.max(prev - 100, 0));
    }, 100);

    return () => clearInterval(interval);
  }, [cooldownRemaining]);

  const updateScale = (newScale: number) => {
    scaleRef.current = newScale;
    setDisplayScale(newScale);
  };

  const drawHoverPixel = (ctx: CanvasRenderingContext2D) => {
    if (!hoverPixel) return;
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
    if (!ctx) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

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

    pixelsRef.current.forEach((color, key) => {
      const [x, y] = key.split(":").map(Number);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    });

    drawHoverPixel(ctx);
    drawGrid(ctx);

    ctx.restore();
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

  const centerCanvas = () => {
    const canvas = canvasRef.current;

    if (!canvas) return;
    updateScale(INITIAL_SCALE);

    offsetRef.current = {
      x: (canvas.width - CANVAS_WIDTH * INITIAL_SCALE) / 2,
      y: (canvas.height - CANVAS_HEIGHT * INITIAL_SCALE) / 2,
    };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    centerCanvas();
    drawCanvas();
  }, []);

  useEffect(() => {
    pixelsRef.current = pixels;
    drawCanvas();
  }, [pixels, hoverPixel, displayScale]);

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
    hasDraggedRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (!isDraggingRef.current) {
      const x = Math.floor((mouseX - offsetRef.current.x) / scaleRef.current);
      const y = Math.floor((mouseY - offsetRef.current.y) / scaleRef.current);
      setHoverPixel(
        x >= 0 && y >= 0 && x < CANVAS_WIDTH && y < CANVAS_HEIGHT
          ? { x, y }
          : null
      );
    } else {
      hasDraggedRef.current = true;
      offsetRef.current.x += e.clientX - dragStartRef.current.x;
      offsetRef.current.y += e.clientY - dragStartRef.current.y;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      drawCanvas();
    }
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleClick = () => {
    if (cooldownRemaining > 0 || hasDraggedRef.current || !hoverPixel) return;

    /*
        const key = `${hoverPixel.x}:${hoverPixel.y}`;

    setPixels((prev) => {
      const newMap = new Map(prev);
      newMap.set(key, selectedColor);
      return newMap;
    });*/

    socketRef.current?.emit("place-pixel", {
      x: hoverPixel.x,
      y: hoverPixel.y,
      color: selectedColor,
    });
  };

  const handleTouchStart = (e: TouchEvent) => {
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

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    lastTouchDistanceRef.current = null;
    lastTouchMidpointRef.current = null;
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
      <div className="fixed bottom-0 left-0 w-full bg-white px-4 py-2 flex justify-center flex-wrap gap-2 border-t border-gray-300 z-10">
        {COLOR_PALETTE.map((color) => (
          <div
            key={color}
            onClick={() => setSelectedColor(color)}
            className={`w-8 h-8 rounded cursor-pointer border ${
              selectedColor === color
                ? "border-black border-2"
                : "border-gray-400"
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </div>

      <button
        onClick={() => {
          centerCanvas();
          drawCanvas();
        }}
        className="cursor-pointer fixed top-4 right-4 z-20 bg-white border border-gray-300 text-sm rounded-md px-4 py-2 font-medium shadow-md hover:bg-gray-100 transition"
      >
        Center
      </button>

      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-crosshair"
        onClick={handleClick}
      />

      <div className="absolute top-2 left-1/2 transform -translate-x-1/2 bg-white/80 px-3 py-1 rounded font-bold z-10">
        Zoom: {Math.round(displayScale * 100) / 100}x
      </div>
      {cooldownRemaining > 0 && (
        <div className="absolute top-2 left-2 bg-red-500 text-white text-sm px-3 py-1 rounded shadow z-10">
          Cooldown: {(cooldownRemaining / 1000).toFixed(1)}s
        </div>
      )}
    </div>
  );
};

export default PixelCanvas;
