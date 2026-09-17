"use client";

import { useRef, type Dispatch, type PointerEvent, type SetStateAction, type WheelEvent } from "react";

type Coordinate = { lat: number; lon: number };
type PixelPoint = { x: number; y: number };

type Options = {
  center: Coordinate;
  zoom: number;
  setCenter: Dispatch<SetStateAction<Coordinate>>;
  setZoom: Dispatch<SetStateAction<number>>;
  project: (point: Coordinate, zoom: number) => PixelPoint;
  unproject: (point: PixelPoint, zoom: number) => Coordinate;
  mapWidth: number;
  mapHeight: number;
  minimumZoom?: number;
  maximumZoom?: number;
  mousePan?: boolean;
};

export function useMapGestures({
  center,
  zoom,
  setCenter,
  setZoom,
  project,
  unproject,
  mapWidth,
  mapHeight,
  minimumZoom = 7,
  maximumZoom = 19,
  mousePan = false,
}: Options) {
  const pointers = useRef(new Map<number, PixelPoint>());
  const drag = useRef<{ pointerId: number; start: PixelPoint; center: PixelPoint; moved: boolean } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const suppressClick = useRef(false);

  function pointerDistance() {
    const values = Array.from(pointers.current.values());
    return values.length < 2 ? 0 : Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" && !mousePan) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size >= 2) {
      pinch.current = { distance: Math.max(1, pointerDistance()), zoom };
      drag.current = null;
      suppressClick.current = true;
      return;
    }
    drag.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      center: project(center, zoom),
      moved: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const nextZoom = Math.round(pinch.current.zoom + Math.log2(Math.max(1, pointerDistance()) / pinch.current.distance));
      setZoom(Math.min(maximumZoom, Math.max(minimumZoom, nextZoom)));
      suppressClick.current = true;
      return;
    }
    const activeDrag = drag.current;
    if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const deltaX = ((event.clientX - activeDrag.start.x) / rect.width) * mapWidth;
    const deltaY = ((event.clientY - activeDrag.start.y) / rect.height) * mapHeight;
    if (Math.hypot(event.clientX - activeDrag.start.x, event.clientY - activeDrag.start.y) > 7) {
      activeDrag.moved = true;
      suppressClick.current = true;
    }
    setCenter(unproject({ x: activeDrag.center.x - deltaX, y: activeDrag.center.y - deltaY }, zoom));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const activeDrag = drag.current;
    if (activeDrag?.pointerId === event.pointerId && activeDrag.moved) suppressClick.current = true;
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    pinch.current = null;
    drag.current = null;
    if (pointers.current.size === 1) {
      const [pointerId, point] = Array.from(pointers.current.entries())[0];
      drag.current = { pointerId, start: point, center: project(center, zoom), moved: true };
    }
  }

  function onWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    setZoom((current) => Math.min(maximumZoom, Math.max(minimumZoom, current + (event.deltaY < 0 ? 1 : -1))));
  }

  function consumeSuppressedClick() {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onWheel, consumeSuppressedClick };
}
