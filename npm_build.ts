import { build, emptyDir } from "https://deno.land/x/dnt@0.38.1/mod.ts";

async function buildNpm() {
  await emptyDir("npm");

  await build({
    entryPoints: ["./mod.ts"],
    outDir: "npm",
    shims: {
      deno: true,
      crypto: true,
    },
    package: {
      name: "env-event-stream",
      version: Deno.args[0] || "1.0.0",
      description: "A high-performance, feature-rich event stream library for event-driven architectures",
      author: "Elastic Networth Visualizer",
      license: "MIT",
      repository: {
        type: "git",
        url: "https://github.com/elastic-networth-visualizer/env-event-stream.git",
      },
      bugs: {
        url: "https://github.com/elastic-networth-visualizer/env-event-stream/issues",
      },
      keywords: [
        "event-stream", 
        "event-sourcing", 
        "event-driven", 
        "publish-subscribe", 
        "deno",
        "typescript"
      ],
      engines: {
        "node": ">=16.0.0"
      }
    },
    typeCheck: "both",
    test: false,
    declaration: "separate",
    scriptModule: "cjs",
    compilerOptions: {
      lib: ["ES2021", "DOM"],
      target: "ES2021",
    }
  });

  // Copy README and LICENSE
  await Deno.copyFile("README.md", "npm/README.md");
  await Deno.copyFile("LICENSE", "npm/LICENSE");

  console.log("NPM package built successfully!");
}

buildNpm().catch(console.error);