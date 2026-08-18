/**
 * tsdown build preset for dsh-web-pets.
 *
 * Two artifacts:
 *   lib/index.js   — host loader entry (ESM, node)
 *   lib/client.js  — browser client bundle (CJS), wrapped for the web shell's
 *                    module loader: window.__ModuleLoader__.load({ id, factory })
 *
 * The client imports react / react-dom/client through the shell's module loader
 * (never bundled), while built-in pet GIFs are inlined as data URIs
 * (src/client/art.generated.ts), so the client bundle is self-contained.
 */
import type { UserConfig } from 'tsdown'

const PKG = 'dsh-web-pets'

/** Host half: a plain ESM module that exports name / inject / apply. */
export function hostConfig(id: string = PKG): UserConfig {
  return {
    name: id,
    entry: { index: 'src/host/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: false,
    fixedExtension: false,
  }
}

/** Client half: a self-contained CJS bundle handed to the web shell's loader. */
export function clientConfig(id: string = PKG): UserConfig {
  return {
    name: id + "/client",
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    dts: false,
    clean: false,
    fixedExtension: false,
    deps: {
      neverBundle: ['react', 'react-dom', 'react-dom/client'],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-web-pets", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

export default [hostConfig(PKG), clientConfig(PKG)]

