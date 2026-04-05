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
      // Population tiers control visibility at different zoom levels
      for (const city of CITIES) {
        const pop = city.population;
        let font: string, outlineWidth: number, maxDist: number, dotSize: number;

        if (pop >= 5000000) {
          font = "bold 16px DM Sans, sans-serif"; outlineWidth = 5; maxDist = 10000000; dotSize = 6;
        } else if (pop >= 1000000) {
          font = "bold 14px DM Sans, sans-serif"; outlineWidth = 4; maxDist = 5000000; dotSize = 5;
        } else if (pop >= 300000) {
          font = "bold 13px DM Sans, sans-serif"; outlineWidth = 3; maxDist = 2000000; dotSize = 4;
        } else if (pop >= 100000) {
          font = "13px DM Sans, sans-serif"; outlineWidth = 3; maxDist = 800000; dotSize = 3;
        } else if (pop >= 50000) {
          font = "12px DM Sans, sans-serif"; outlineWidth = 2; maxDist = 400000; dotSize = 3;
        } else {
          font = "11px DM Sans, sans-serif"; outlineWidth = 2; maxDist = 200000; dotSize = 2;
        }

        viewer.entities.add({
          position: Cartesian3.fromDegrees(city.lng, city.lat, 0),
          label: {
            text: city.name,
            font,
            fillColor: Color.WHITE,
            outlineColor: Color.BLACK,
            outlineWidth,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.LEFT,
            pixelOffset: new Cartesian2(6, -4),
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new DistanceDisplayCondition(0, maxDist),
          },
          point: {
            pixelSize: dotSize,
            color: Color.WHITE.withAlpha(0.9),
            outlineColor: Color.BLACK.withAlpha(0.6),
            outlineWidth: 1,
            heightReference: HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new DistanceDisplayCondition(0, maxDist),
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
