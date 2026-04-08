import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { transformAsync } from "@babel/core"
import solid from "babel-preset-solid"
import ts from "@babel/preset-typescript"

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const distDir = resolve(root, "dist")

async function buildTsx(inputPath, outputPath) {
  const source = await readFile(inputPath, "utf8")
  const result = await transformAsync(source, {
    filename: inputPath,
    configFile: false,
    babelrc: false,
    presets: [
      [
        solid,
        {
          moduleName: "@opentui/solid",
          generate: "universal",
        },
      ],
      [ts],
    ],
  })

  if (!result?.code) {
    throw new Error(`Failed to build ${inputPath}`)
  }

  const contents = result.code

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${contents}\n`, "utf8")
}

await rm(distDir, { recursive: true, force: true })
await buildTsx(resolve(root, "plugins", "tui-token-usage.tsx"), resolve(distDir, "plugins", "tui-token-usage.js"))
await writeFile(resolve(distDir, "index.js"), 'export { default } from "./plugins/tui-token-usage.js"\n', "utf8")
