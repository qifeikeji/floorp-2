import { render } from "preact";
import { AboutDialog } from "./AboutDialog.tsx";
import { initI18nextInstance } from "./lib/i18n/i18n";

const root = document.getElementById("root");
if (root) {
  initI18nextInstance().then(() => {
    render(<AboutDialog />, root);
  });
}
