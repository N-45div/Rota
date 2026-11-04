// Rota's look for the shared sign-in page: a tomato story panel on the left,
// a cream form on the right. The page's own CSS reads these variables and
// classes; the style is a React 19 hoisted <style> so hydration keeps it.

import { AuthPage, type AuthPageProps } from "@agent-native/toolkit/app/auth";
import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";

/* guard:allow-raw-color - the sign-in page is standalone HTML with no app theme tokens */
const CSS = `
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap");
body.has-marketing {
  color-scheme: light;
  --auth-marketing-left-bg: #e4572e;
  --auth-marketing-right-bg: #fbf7f2;
  --auth-marketing-foreground: #2b211c;
  --auth-marketing-muted: #6f625a;
  --auth-marketing-subtle: #8a7c73;
  --auth-marketing-border: #e6dbd0;
  --auth-marketing-badge-bg: #f3ece4;
  background: #fbf7f2;
  color: #2b211c;
}
body.has-marketing .auth-page { --auth-wave-bg: #fbf7f2; --auth-wave-fg: #e4572e; }
body.has-marketing .auth-wave-background { display: none; }
.auth-marketing-home .marketing-panel {
  background:
    radial-gradient(120% 80% at 0% 100%, rgba(43, 33, 28, 0.28), transparent 60%),
    radial-gradient(90% 70% at 100% 0%, rgba(255, 196, 140, 0.35), transparent 55%),
    #e4572e;
  color: #fbf7f2;
}
.auth-marketing-home .auth-marketing-visual {
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22426%22%20height%3D%22190%22%20viewBox%3D%220%200%20426%20190%22%3E%3Crect%20x%3D%220%22%20y%3D%220%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%2262%22%20y%3D%220%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%220%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%22186%22%20y%3D%220%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22248%22%20y%3D%220%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.4%22%2F%3E%3Crect%20x%3D%22310%22%20y%3D%220%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22372%22%20y%3D%220%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%220%22%20y%3D%2240%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%2262%22%20y%3D%2240%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.4%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%2240%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22186%22%20y%3D%2240%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22248%22%20y%3D%2240%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%22310%22%20y%3D%2240%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%232b211c%22%20fill-opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22372%22%20y%3D%2240%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%220%22%20y%3D%2280%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%2262%22%20y%3D%2280%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%2280%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22187%22%20y%3D%2281%22%20width%3D%2252%22%20height%3D%2228%22%20rx%3D%227%22%20fill%3D%22none%22%20stroke%3D%22%23fbf7f2%22%20stroke-width%3D%222%22%20stroke-dasharray%3D%225%204%22%2F%3E%3Crect%20x%3D%22248%22%20y%3D%2280%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22310%22%20y%3D%2280%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%22372%22%20y%3D%2280%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.4%22%2F%3E%3Crect%20x%3D%220%22%20y%3D%22120%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.4%22%2F%3E%3Crect%20x%3D%2262%22%20y%3D%22120%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%22120%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%22186%22%20y%3D%22120%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22248%22%20y%3D%22120%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22310%22%20y%3D%22120%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.4%22%2F%3E%3Crect%20x%3D%22372%22%20y%3D%22120%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%220%22%20y%3D%22160%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%2262%22%20y%3D%22160%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22124%22%20y%3D%22160%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%232b211c%22%20fill-opacity%3D%22.85%22%2F%3E%3Crect%20x%3D%22186%22%20y%3D%22160%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.1%22%2F%3E%3Crect%20x%3D%22248%22%20y%3D%22160%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.4%22%2F%3E%3Crect%20x%3D%22310%22%20y%3D%22160%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3Crect%20x%3D%22372%22%20y%3D%22160%22%20width%3D%2254%22%20height%3D%2230%22%20rx%3D%227%22%20fill%3D%22%23fbf7f2%22%20fill-opacity%3D%22.9%22%2F%3E%3C%2Fsvg%3E");
  background-repeat: no-repeat;
  background-position: 80px 48%;
  background-size: min(424px, 70%) auto;
}
@media not all and (min-width: 901px) {
  .auth-marketing-home .auth-marketing-visual { background-image: none; }
}
.auth-marketing-home .app-name { color: #fbf7f2; }
.auth-marketing-home .app-name-label { font-family: "Fraunces", Georgia, serif; font-weight: 600; letter-spacing: -0.02em; }
.auth-marketing-home .app-name img.brand-mark {
  filter: none;
  height: 2.25rem;
  border-radius: 0.6rem;
  box-shadow: 0 0 0 2px rgba(251, 247, 242, 0.55);
}
.auth-marketing-home .app-status-badge,
.auth-marketing-home .marketing-actions { display: none; }
.auth-marketing-home .auth-marketing-headline {
  color: #fbf7f2;
  font-family: "Fraunces", Georgia, serif;
  font-weight: 600;
  letter-spacing: -0.025em;
}
.auth-marketing-home .auth-marketing-description { color: rgba(251, 247, 242, 0.88); }
.auth-marketing-home .form-panel { background: #fbf7f2; border-inline-start: 0; }
.auth-marketing-home .card h1 { color: #2b211c; font-family: "Fraunces", Georgia, serif; font-weight: 600; letter-spacing: -0.02em; }
.auth-marketing-home .card .subtitle,
body.has-marketing label { color: #6f625a; }
body.has-marketing .tabs { background: #efe5da; }
body.has-marketing .tab { color: #6f625a; }
body.has-marketing .tab.active { background: #ffffff; color: #2b211c; box-shadow: 0 1px 2px rgba(43, 33, 28, 0.12); }
body.has-marketing .tab:hover:not(.active) { color: #2b211c; }
body.has-marketing .auth-marketing-home .card input { background: #ffffff; color: #2b211c; border-color: #e2d6cb; }
body.has-marketing .auth-marketing-home .card input:focus { border-color: #e4572e; box-shadow: 0 0 0 3px rgba(228, 87, 46, 0.18); }
body.has-marketing .auth-marketing-home .card input::placeholder { color: #a39488; }
body.has-marketing .auth-marketing-home .card button[type="submit"],
body.has-marketing .btn-primary { background: #e4572e; color: #ffffff; border: 0; }
body.has-marketing button[type="submit"]:hover,
body.has-marketing .btn-primary:hover { background: #cf4a23; }
body.has-marketing .btn-secondary { background: #ffffff; color: #2b211c; border-color: #e2d6cb; }
body.has-marketing .btn-secondary:hover { color: #2b211c; border-color: #cbbcae; }
body.has-marketing .locale-trigger { color: #6f625a; }
body.has-marketing .locale-menu { background: #ffffff; border-color: #e6dbd0; }
body.has-marketing .locale-menu-item { color: #6f625a; }
body.has-marketing .locale-menu-item:focus,
body.has-marketing .locale-menu-item[aria-checked="true"] { background: #f3ece4; color: #2b211c; }
body.has-marketing .locale-menu-check { color: #e4572e; }
body.has-marketing .msg.success { color: #2f7d4f; }
body.has-marketing .msg.error { color: #c0392b; }
body.has-marketing .legal-note,
body.has-marketing .legal-note a { color: #8a7c73; }
`;

export function renderRotaAuthPage(props: AuthPageProps): string {
  return renderToString(
    createElement(
      Fragment,
      null,
      createElement("style", { href: "rota-auth-brand", precedence: "rota" }, CSS),
      createElement(AuthPage, props),
    ),
  );
}
