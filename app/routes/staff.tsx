import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Team · Rota" }];
}

export default function StaffLayout() {
  return <Outlet />;
}
