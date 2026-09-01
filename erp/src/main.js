import { ErpApp } from "./app.js";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("ERP application root олдсонгүй.");
}

const app = new ErpApp({ root });
app.start().catch((error) => {
  root.setAttribute("aria-busy", "false");
  root.innerHTML = `<main id="main-content" class="boot-state"><h1>Системийг эхлүүлж чадсангүй</h1><p></p></main>`;
  root.querySelector("p").textContent = error instanceof Error ? error.message : "Тодорхойгүй алдаа";
});

