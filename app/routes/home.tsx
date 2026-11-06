import { Navigate } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

// The chat routes reuse this page title.
export function meta() {
  return [{ title: `Ask ${APP_TITLE}` }];
}

// The framework still links to /home in a few places; Rota's home is the roster.
export default function HomeRoute() {
  return <Navigate to="/roster" replace />;
}
