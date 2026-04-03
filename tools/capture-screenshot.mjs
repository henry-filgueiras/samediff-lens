import { mkdirSync } from "node:fs";
import { request } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const previewPort = 4174;
const previewUrl = `http://127.0.0.1:${previewPort}/`;
const outputPath = resolve(repoRoot, "docs/screenshots/app-home.png");

mkdirSync(resolve(repoRoot, "docs/screenshots"), { recursive: true });

await runCommand("npm", ["run", "build"], {
  cwd: repoRoot,
  env: process.env,
});

const previewProcess = spawn(
  "npm",
  ["run", "preview", "--", "--host", "127.0.0.1", "--port", String(previewPort), "--strictPort"],
  {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  },
);

try {
  await waitForServer(previewUrl);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: {
      width: 1440,
      height: 1320,
    },
    deviceScaleFactor: 1.5,
  });

  await page.goto(previewUrl, { waitUntil: "networkidle" });
  await page.screenshot({
    path: outputPath,
    fullPage: true,
  });
  await browser.close();
  console.log(`Saved screenshot to ${outputPath}`);
} finally {
  previewProcess.kill("SIGTERM");
}

function runCommand(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "null"}.`));
    });
  });
}

function waitForServer(url, attempts = 60) {
  return new Promise((resolvePromise, rejectPromise) => {
    let remaining = attempts;

    const ping = () => {
      const req = request(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolvePromise();
          return;
        }

        retry();
      });

      req.on("error", retry);
      req.end();
    };

    const retry = () => {
      remaining -= 1;
      if (remaining <= 0) {
        rejectPromise(new Error(`Preview server did not respond at ${url}.`));
        return;
      }

      setTimeout(ping, 500);
    };

    ping();
  });
}
