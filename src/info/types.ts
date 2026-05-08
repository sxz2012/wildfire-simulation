import type { ReactNode } from "react";

export type InfoModalId =
  | "predictionModel"
  | "firePhysics"
  | "suppression";

export interface InfoModalContent {
  id: InfoModalId;
  icon: string;
  title: string;
  subtitle?: string;
  body: ReactNode;
  sources?: ReactNode;
}
