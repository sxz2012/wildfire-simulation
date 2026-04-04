import { Viewer, Globe } from "resium";
import {
  Ion,
  createGooglePhotorealistic3DTileset,
  Terrain,
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler as CesiumScreenSpaceEventHandler,
  Cartesian2,
} from "cesium";
import { useEffect, useRef } from "react";
import type { CesiumComponentRef } from "resium";
import type { Viewer as CesiumViewer } from "cesium";

// User must provide their own API keys
Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";

interface GlobeViewProps {
  onIgnite?: (lat: number, lng: number) => void;
  children?: React.ReactNode;
  flyTo?: { lat: number; lng: number; altitude: number } | null;
  onViewerReady?: (viewer: CesiumViewer) => void;
}

export default function GlobeView({ onIgnite, children, flyTo, onViewerReady }: GlobeViewProps) {
  const viewerRef = useRef<CesiumComponentRef<CesiumViewer>>(null);

  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer) return;

    // Add Google Photorealistic 3D Tiles
    const addTileset = async () => {
      try {
        const tileset = await createGooglePhotorealistic3DTileset(
          import.meta.env.VITE_GOOGLE_MAPS_API_KEY
            ? { key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY }
            : undefined
        );
        viewer.scene.primitives.add(tileset);
      } catch (e) {
        console.error("Failed to load Google 3D Tiles:", e);
      }
    };
    addTileset();

    // Set initial camera to overview of California
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(-119.5, 36.7, 500000),
    });

    if (onViewerReady) onViewerReady(viewer);
  }, [onViewerReady]);

  // Click-to-ignite handler
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer || !onIgnite) return;

    const handler = new CesiumScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: { position: Cartesian2 }) => {
      const cartesian = viewer.scene.pickPosition(event.position);
      if (!cartesian) return;
      const carto = Cartographic.fromCartesian(cartesian);
      onIgnite(
        CesiumMath.toDegrees(carto.latitude),
        CesiumMath.toDegrees(carto.longitude),
      );
    }, ScreenSpaceEventType.LEFT_CLICK);

    return () => handler.destroy();
  }, [onIgnite]);

  // Fly camera to location when flyTo changes
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement;
    if (!viewer || !flyTo) return;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(flyTo.lng, flyTo.lat, flyTo.altitude),
    });
  }, [flyTo]);

  return (
    <Viewer
      ref={viewerRef}
      full
      timeline={false}
      animation={false}
      homeButton={false}
      baseLayerPicker={false}
      navigationHelpButton={false}
      sceneModePicker={false}
      geocoder={false}
      terrain={Terrain.fromWorldTerrain()}
    >
      <Globe depthTestAgainstTerrain />
      {children}
    </Viewer>
  );
}
