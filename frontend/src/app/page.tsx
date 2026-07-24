import { Suspense } from "react";

import { App } from "@/ui/App";

import { Providers } from "./providers";

export default function Home() {
  return (
    <Providers>
      {/* Suspense boundary required by useSearchParams (URL-as-state, §10) */}
      <Suspense>
        <App />
      </Suspense>
    </Providers>
  );
}
