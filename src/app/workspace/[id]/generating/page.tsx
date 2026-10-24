import { Suspense } from "react";
import GeneratingClient from "./GeneratingClient";

export default function GeneratingPage() {
  return (
    <Suspense fallback={null}>
      <GeneratingClient />
    </Suspense>
  );
}
