import { Outlet } from "react-router";

export function meta() {
  return [{ title: "Roster · Rota" }];
}

export default function RosterLayout() {
  return <Outlet />;
}
