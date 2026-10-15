import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(projectRoot, "dist");

if (dirname(outputDir) !== projectRoot) {
  throw new Error("Refusing to build outside the project dist directory.");
}

const htmlPages = [
  "index.html",
  "invite.html",
  "info.html",
  "menu.html",
  "programme.html",
  "registry.html",
  "rsvp.html",
  "owner.html"
];
const publicImages = [
  "background.jpg",
  "couple.png",
  "menu.jpg",
  "programme.jpeg"
];

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(join(outputDir, "img"), { recursive: true });

for (const file of [...htmlPages, "script.js", "owner.js", "style.css", "owner.css"]) {
  cpSync(join(projectRoot, file), join(outputDir, file));
}

for (const file of publicImages) {
  cpSync(join(projectRoot, "img", file), join(outputDir, "img", file));
}
