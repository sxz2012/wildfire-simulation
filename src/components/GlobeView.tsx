import { useEffect, useRef } from "react";
import {
  Viewer as CesiumViewer,
  Ion,
  createGooglePhotorealistic3DTileset,
  createWorldTerrainAsync,
  Cartesian3,
  Cartographic,
  Math as CesiumMath,
  ScreenSpaceEventType,
  ScreenSpaceEventHandler,
  Cartesian2,
  Color,
  LabelStyle,
  VerticalOrigin,
  HorizontalOrigin,
  HeightReference,
  NearFarScalar,
  DistanceDisplayCondition,
} from "cesium";
import { CITIES } from "../data/cities";
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

    const setup = async () => {
      // Add world terrain (elevation data)
      try {
        viewer.scene.terrainProvider = await createWorldTerrainAsync();
      } catch (e) {
        console.error("Failed to load world terrain:", e);
      }

      // Add Google Photorealistic 3D Tiles
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

      // Add city/place labels as Cesium entities (no tile clipping)
      for (const city of CITIES) {
        const isMajor = city.population >= 1000000;
        const isMedium = city.population >= 100000;

        viewer.entities.add({
          position: Cartesian3.fromDegrees(city.lng, city.lat, 0),
          label: {
            text: city.name,
            font: isMajor ? "bold 15px DM Sans, sans-serif" : isMedium ? "bold 13px DM Sans, sans-serif" : "12px DM Sans, sans-serif",
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth: isMajor ? 4 : 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.LEFT,
            pixelOffset: new Cartesian2(6, -4),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new NearFarScalar(
              isMajor ? 1000 : 500,
              isMajor ? 1.2 : 1.0,
              isMajor ? 8000000 : 3000000,
              isMajor ? 0.4 : 0.0
            ),
            distanceDisplayCondition: new DistanceDisplayCondition(
              0,
              isMajor ? 8000000 : isMedium ? 2000000 : 500000
            ),
          },
          point: {
            pixelSize: isMajor ? 5 : 4,
            color: Color.WHITE.withAlpha(0.9),
            outlineColor: Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new DistanceDisplayCondition(
              0,
              isMajor ? 8000000 : isMedium ? 2000000 : 500000
            ),
          },
        });
      }
    };
    setup();

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
