import { useEffect, useRef } from "react";
import {
  Viewer as CesiumViewer,
  Ion,
  createGooglePhotorealistic3DTileset,
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  Cartesian2,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";

interface GlobeViewProps {
  onIgnite?: (lat: number, lng: number) => void;
  flyTo?: { lat: number; lng: number; altitude: number } | null;
  onViewerReady?: (viewer: CesiumViewer) => void;
}

export default function GlobeView({ onIgnite, flyTo, onViewerReady }: GlobeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<CesiumViewer | null>(null);
  const onIgniteRef = useRef(onIgnite);
  onIgniteRef.current = onIgnite;

  // Create viewer once
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const viewer = new CesiumViewer(containerRef.current, {
      timeline: false,
      animation: false,
      homeButton: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      geocoder: false,
    });

    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewerRef.current = viewer;

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

    // Initial camera position — California overview
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(-119.5, 36.7, 500000),
    });

    // Click-to-ignite handler
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((event: { position: Cartesian2 }) => {
      if (!onIgniteRef.current) return;
      const cartesian = viewer.scene.pickPosition(event.position);
      if (!cartesian) return;
      const carto = Cartographic.fromCartesian(cartesian);
      onIgniteRef.current(
        CesiumMath.toDegrees(carto.latitude),
        CesiumMath.toDegrees(carto.longitude),
      );
    }, ScreenSpaceEventType.LEFT_CLICK);

    if (onViewerReady) onViewerReady(viewer);

    return () => {
      handler.destroy();
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly camera when flyTo changes
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !flyTo) return;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(flyTo.lng, flyTo.lat, flyTo.altitude),
    });
  }, [flyTo]);

  return <div ref={containerRef} className="w-full h-full" />;
}
