import { Viewer, Globe } from "resium";
import {
  Ion,
  createGooglePhotorealistic3DTileset,
  Terrain,
  Cartesian3,
} from "cesium";
import { useEffect, useRef } from "react";
import type { CesiumComponentRef } from "resium";
import type { Viewer as CesiumViewer } from "cesium";

// User must provide their own API keys
Ion.defaultAccessToken = import.meta.env.VITE_CESIUM_ION_TOKEN ?? "";

export default function GlobeView() {
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
  }, []);

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
    </Viewer>
  );
}
