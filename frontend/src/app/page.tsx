import { Suspense } from "react";

import { Wall } from "@/wall/Wall";

import { Providers } from "./providers";

export default function Home() {
  return (
    <Providers>
      {/* Suspense boundary required by useSearchParams (URL-as-state, §10) */}
      <Suspense>
        <Wall />
      </Suspense>
    </Providers>
  );
}
