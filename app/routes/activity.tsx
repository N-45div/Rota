import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Activity · Rota" }];
}

export default function ActivityLayout() {
  return <Outlet />;
}
