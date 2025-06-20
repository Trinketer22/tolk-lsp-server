import { TolkCompilerSDK, defaultConfig } from "./config-scheme";
import { connection } from "./connection";
import { SymbolIndex } from "./lsp-features/symbol-index";
import { RequestFromServer } from "./shared-msgtypes";
import { URI } from 'vscode-uri';

/*
  This is a server cache [documentUri -> tolkSdk].
  The server only requests tolkSdk from a client (for each opened/parsed document),
whereas actual automatic TolkCompilerSDK detection is made by a client (see client/tolk-sdk-detect.ts).
 */
export class TolkSdkMapping {
  private tolkSdk: { [uri in string]: TolkCompilerSDK | null } = {}
  
  constructor(private readonly _symbolIndex: SymbolIndex, private readonly _clientSupportsDetect: boolean, private readonly _sdkPath?: string) {
  }

  async getOrRequestTolkSdkForFile(uri: string): Promise<TolkCompilerSDK | null> {
    if (uri in this.tolkSdk) {
      return this.tolkSdk[uri]
    }

    let tolkSdk: TolkCompilerSDK | null;

    if((!this._clientSupportsDetect) || this._sdkPath) {
        if(this._sdkPath) {
          tolkSdk = {...defaultConfig.manualSDKSettings, stdlibFolder: this._sdkPath, detectedMethod: 'manual-setting'};
        } else {
          tolkSdk = {...defaultConfig.manualSDKSettings, detectedMethod: 'manual-setting'};
        }
    } else {
    try {
      tolkSdk = await connection.sendRequest<TolkCompilerSDK | null>(RequestFromServer.detectSdkForFile, uri)
    } catch {
      // Method is not supported by client,
      console.log("Fallback to bundled tolk sdk");
      tolkSdk = {...defaultConfig.manualSDKSettings, detectedMethod: 'manual-setting'};
    }
    }

    if (tolkSdk) {
      // tolkSdk for file has been detected; now we know compiler version (what syntax features are enabled)
      // and stdlib location (what global functions are available)
      // save it into cache not to request every time
      // (when the user changes settings or Tolk SDK is re-discovered, this cache is cleared)
      this.tolkSdk[uri] = tolkSdk
      // this._symbolIndex.addFile(URI.file(tolkSdk.stdlibFolder + '/common.tolk').toString())
      console.log(`tolkSdk v${tolkSdk.tolkCompilerVersion} (via ${tolkSdk.detectedMethod}) for ${uri}`)
    } else {
      // tolkSdk for file can't be detected
      // there are several reasons:
      // 1) the user has non-standard Tolk installation, or the project is yet empty (`npm i` not done)
      // 2) the opened file is outside the workspace
      // in this case, also remember that tolkSdk for this uri is empty, not to request it every time
      // (when the user changes settings or Tolk SDK is re-discovered, this cache is cleared)
      this.tolkSdk[uri] = null
      console.log(`tolkSdk not detected for ${uri}`)
    }
    return tolkSdk
  }

  resetCache() {
    for (let uri in this.tolkSdk) {
      if (this.tolkSdk[uri]) {
        this._symbolIndex.removeFile(URI.file(this.tolkSdk[uri].stdlibFolder + '/common.tolk').toString())
      }
    }
    this.tolkSdk = {}
    console.log('tolkSdk server cache cleared, will re-request on demand')
  }
}
