import { createRoute } from "@tanstack/react-router";
import { BrandPage } from "../components/pages/brand.tsx";
import { rootRoute } from "./__root.tsx";

const title = "Tab Brand Assets - Logos, colors, and usage";
const description = "Download the Tab mark and lockup in SVG, PNG, WebP, and JPG, with light and dark variants, brand colors, typography, and usage guidance.";

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "brand",
  component: BrandPage,
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
    ],
  }),
});
