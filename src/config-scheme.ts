// this file is shared between a client and a server, don't import anything
// it's a typed description of package.json, "configuration" > "properties"

import * as path from 'path';
export type TolkCompilerVersion = string

export type TolkCompilerSDK = {
  detectedMethod: 'node_modules' | 'system-path' | 'manual-setting'
  tolkCompilerVersion: TolkCompilerVersion
  stdlibFolder: string
}

// package.json, configuration properties keys
export interface TolkPluginConfigScheme {
  autocompleteAddParentheses: boolean
  experimentalDiagnostics: boolean
  autoDetectSDK: boolean
  manualSDKSettings: {
    tolkCompilerVersion: TolkCompilerVersion
    stdlibFolder: string
  }
}

// package.json, configuration properties default values
export const defaultConfig: TolkPluginConfigScheme = {
  autocompleteAddParentheses: true,
  experimentalDiagnostics: false,
  autoDetectSDK: false,
  manualSDKSettings: {
    tolkCompilerVersion: "0.99",
    stdlibFolder: path.join(__dirname,"../node_modules/@ton/tolk-js/dist/tolk-stdlib")
  }
}
