import type { Metadata } from "next";
import { WaveProgressDemo } from "@/components/wave-progress-demo";

export const metadata: Metadata = {
  title: "水波进度动画 · 探山 Tanshan",
  description: "探山动态澄清流程的水波进度动画原型。",
};

export default function WaveProgressPage() {
  return <WaveProgressDemo />;
}
