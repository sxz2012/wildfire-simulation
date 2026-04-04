import { useEffect, useRef, useMemo } from "react";
import {
  Cartesian3,
  Color,
  ParticleSystem,
  CircleEmitter,
  Cartesian2,
  Matrix4,
  TranslationRotationScale,
  Quaternion,
} from "cesium";
import type { Viewer as CesiumViewer } from "cesium";

interface FireEffectsProps {
  /** Lat/lng positions of active fire hotspots */
  activePositions: { lat: number; lng: number }[];
  viewer: CesiumViewer | null;
  /** Max number of fire particle systems (for performance) */
  maxSystems?: number;
}

function createFireTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 20;
  canvas.height = 20;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(10, 10, 0, 10, 10, 10);
  gradient.addColorStop(0, "rgba(255, 255, 200, 1)");
  gradient.addColorStop(0.2, "rgba(255, 180, 50, 0.9)");
  gradient.addColorStop(0.5, "rgba(255, 80, 0, 0.6)");
  gradient.addColorStop(1, "rgba(200, 30, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 20, 20);
  return canvas;
}

function createSmokeTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, "rgba(120, 120, 120, 0.4)");
  gradient.addColorStop(0.5, "rgba(100, 100, 100, 0.2)");
  gradient.addColorStop(1, "rgba(80, 80, 80, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 32, 32);
  return canvas;
}

export default function FireEffects({
  activePositions,
  viewer,
  maxSystems = 25,
}: FireEffectsProps) {
  const systemsRef = useRef<ParticleSystem[]>([]);

  const fireTexture = useMemo(() => createFireTexture(), []);
  const smokeTexture = useMemo(() => createSmokeTexture(), []);

  useEffect(() => {
    if (!viewer || viewer.isDestroyed() || activePositions.length === 0) return;

    // Clean up previous systems
    for (const sys of systemsRef.current) {
      viewer.scene.primitives.remove(sys);
    }
    systemsRef.current = [];

    // Sample positions for performance
    let positions = activePositions;
    if (positions.length > maxSystems) {
      const step = Math.ceil(positions.length / maxSystems);
      positions = positions.filter((_, i) => i % step === 0);
    }

    for (const pos of positions) {
      const cartesian = Cartesian3.fromDegrees(pos.lng, pos.lat, 350);
      const modelMatrix = Matrix4.fromTranslationRotationScale(
        new TranslationRotationScale(cartesian, Quaternion.IDENTITY)
      );

      // Fire particles — rise upward, bright colors
      const fireSystem = new ParticleSystem({
        image: fireTexture,
        startColor: Color.fromCssColorString("#FFCC33").withAlpha(0.9),
        endColor: Color.fromCssColorString("#FF3300").withAlpha(0.0),
        startScale: 0.8,
        endScale: 2.5,
        minimumParticleLife: 0.6,
        maximumParticleLife: 1.2,
        minimumSpeed: 3.0,
        maximumSpeed: 8.0,
        emissionRate: 15,
        emitter: new CircleEmitter(50.0),
        modelMatrix,
        minimumImageSize: new Cartesian2(8, 8),
        maximumImageSize: new Cartesian2(16, 16),
        lifetime: 16.0,
      });

      // Smoke particles — rise higher, grey, drift with wind
      const smokeCartesian = Cartesian3.fromDegrees(
        pos.lng + 0.002,
        pos.lat + 0.001,
        600
      );
      const smokeMatrix = Matrix4.fromTranslationRotationScale(
        new TranslationRotationScale(smokeCartesian, Quaternion.IDENTITY)
      );

      const smokeSystem = new ParticleSystem({
        image: smokeTexture,
        startColor: Color.fromCssColorString("#999999").withAlpha(0.3),
        endColor: Color.fromCssColorString("#666666").withAlpha(0.0),
        startScale: 1.5,
        endScale: 6.0,
        minimumParticleLife: 2.0,
        maximumParticleLife: 4.0,
        minimumSpeed: 2.0,
        maximumSpeed: 5.0,
        emissionRate: 5,
        emitter: new CircleEmitter(80.0),
        modelMatrix: smokeMatrix,
        minimumImageSize: new Cartesian2(20, 20),
        maximumImageSize: new Cartesian2(40, 40),
        lifetime: 16.0,
      });

      viewer.scene.primitives.add(fireSystem);
      viewer.scene.primitives.add(smokeSystem);
      systemsRef.current.push(fireSystem, smokeSystem);
    }

    return () => {
      for (const sys of systemsRef.current) {
        if (viewer && !viewer.isDestroyed()) {
          viewer.scene.primitives.remove(sys);
        }
      }
      systemsRef.current = [];
    };
  }, [viewer, activePositions, maxSystems, fireTexture, smokeTexture]);

  return null;
}
