import { createFileRoute } from "@tanstack/react-router";
import { BrandPage } from "../components/pages/brand.tsx";

const title = "Tab Brand Assets - Logos, colors, and usage";
const description = "Download the Tab mark and lockup in SVG, PNG, WebP, and JPG, with light and dark variants, brand colors, typography, and usage guidance.";

export const Route = createFileRoute("/brand")({
  component: BrandPage,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
    ],
  }),
});
