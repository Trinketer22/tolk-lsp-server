#!/usr/bin/env node
import { InitializeParams, TextDocumentSyncKind } from 'vscode-languageserver/node';
import { InitializeResult } from 'vscode-languageserver-protocol';
import { connection, ILspHandler } from './connection';
import { DepsIndex } from './lsp-features/deps-index';
import { DocumentStore } from './document-store';
import { CompletionLspHandler } from './lsp-features/lsp-completion';
import { DefinitionLspHandler } from './lsp-features/lsp-definitions';
import { DiagnosticsProvider } from './lsp-features/diagnostics';
import { DocumentSymbolsLspHandler } from './lsp-features/lsp-document-symbols';
import { FormattingLspHandler } from './lsp-features/lsp-formatting';
import { SymbolIndex } from './lsp-features/symbol-index';
import { initParser } from './parser';
import { Trees } from './trees';
import { RenameLspHandler } from './lsp-features/lsp-rename';
import { mutateConfig, config } from './server-config';
import { CodeAction } from 'vscode-languageserver';
import { findQuickFixByKind } from './lsp-features/quickfixes';
import { TolkSdkMapping } from "./tolk-sdk-mapping";
import { NotificationFromClient } from "./shared-msgtypes";
import { HoverLspHandler } from './lsp-features/lsp-hover'
import { defaultConfig } from './config-scheme';
import { TextDocument } from 'vscode-languageserver-textdocument';


const lspHandlers: ILspHandler[] = [];
let treeSitterWasm: string | undefined;
let tolkTreeSitterWasm: string | undefined;
let tolkSdkPath: string | undefined;

const parseArgs = () => {
  for(let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if(arg.startsWith('--tree-sitter-wasm')) {
      treeSitterWasm = arg.split('=')[1];
      if(!treeSitterWasm) {
        throw Error(`Invalid argument: ${arg}`);
      }
    } else if(arg.startsWith('--tree-sitter-tolk')) {
      tolkTreeSitterWasm = arg.split('=')[1];
      if(!tolkTreeSitterWasm) {
        throw Error(`Invalid argument: ${arg}`);
      }
    } else if(arg.startsWith('--tolk-sdk-path')) {
      tolkSdkPath = arg.split('=')[1];
      if(!tolkSdkPath) {
        throw Error(`Invalid argument: ${arg}`);
      }
    }
  }
}
connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
  // while starting the server, client posted some initializationOptions; for instance, clientConfig
  await initParser(treeSitterWasm ?? params.initializationOptions.treeSitterWasmUri, tolkTreeSitterWasm ?? params.initializationOptions.langWasmUri);
  let supportsReadFile: boolean;
  let supportsSdkDetect: boolean;
  if(params.initializationOptions) {
    mutateConfig(params.initializationOptions.clientConfig || defaultConfig)
    supportsReadFile  = params.initializationOptions.readFileSupported;
    supportsSdkDetect = params.initializationOptions.sdkDetectSupported;
  } else {
    supportsSdkDetect = false;
    supportsReadFile  = false;
    mutateConfig(defaultConfig);
  }

  console.log("Supports sdk detect:", supportsSdkDetect);
  console.log("Supports readFile:", supportsReadFile);

  // Forcing version like this is not appropriate, but such is life
  const documents = new DocumentStore(connection, Number(config.manualSDKSettings.tolkCompilerVersion), supportsReadFile);
  const trees = new Trees(documents);
  const symbolIndex = new SymbolIndex(trees, documents);
  const tolkSdkMapping = new TolkSdkMapping(symbolIndex, supportsSdkDetect, tolkSdkPath)
  const depsIndex = new DepsIndex(documents, trees, symbolIndex, tolkSdkMapping);
  const diagnosticsProvider = new DiagnosticsProvider(depsIndex, symbolIndex, tolkSdkMapping);

  lspHandlers.push(new DocumentSymbolsLspHandler(documents, trees));
  lspHandlers.push(new CompletionLspHandler(documents, trees, symbolIndex, depsIndex));
  lspHandlers.push(new DefinitionLspHandler(documents, trees, symbolIndex, depsIndex));
  lspHandlers.push(new HoverLspHandler(documents, trees, symbolIndex, depsIndex));
  lspHandlers.push(new FormattingLspHandler(documents, trees));
  lspHandlers.push(new RenameLspHandler(documents, trees));

  // manage configuration
  connection.onNotification(NotificationFromClient.onConfigurationChanged, (next) => {
    mutateConfig(next)
    tolkSdkMapping.resetCache() // in case settings around tolkSdk changed, re-request from a client
  });
  connection.onNotification(NotificationFromClient.forceUpdateDiagnostics, async (documentUri: string) => {
    connection.sendNotification("Diagnostics!");
    documents.retrieve(documentUri).then(document => {
      let tree = document && trees.getParseTree(document)
      if (tree) {
        diagnosticsProvider.provideDiagnostics(document!, tree)
      }
    })
  })

  // manage symbol index. add/remove files as they are discovered and edited
  documents.all().forEach(doc => symbolIndex.addFile(doc.uri));
  documents.onDidOpen(event => {
    symbolIndex.addFile(event.document.uri);
  });
  documents.onDidChangeContent(event => {
      // connection.sendRequest('didChangeContent called!');
      symbolIndex.addFile(event.document.uri)
  });
  connection.onNotification(NotificationFromClient.removeFileFromQueue, uri => symbolIndex.removeFile(uri));
  connection.onNotification(NotificationFromClient.addFileToQueue, uri => symbolIndex.addFile(uri));
  connection.onNotification(NotificationFromClient.initQueue, uris => symbolIndex.initFiles(uris));
  connection.onNotification(NotificationFromClient.clearTolkEnvCache, () => tolkSdkMapping.resetCache())
  connection.onDidOpenTextDocument((params) => {
    // For whatever reason that is what stored
    const td = Promise.resolve(TextDocument.create(params.textDocument.uri, params.textDocument.languageId, params.textDocument.version, params.textDocument.text));
    documents.add(params.textDocument.uri, td);
    // symbolIndex.addFile(params.textDocument.uri);
  });

  connection.onCodeAction(params => {
    let document = documents.get(params.textDocument.uri)
    let tree = document ? trees.getParseTree(document) : undefined
    if (params.context.diagnostics.length === 0 || !document || !tree) {
      return []
    }

    let actions = [] as CodeAction[]
    for (let diagnostic of params.context.diagnostics) {
      // data.fixes contains an array of kind, see CollectedDiagnostics
      if (diagnostic.data && Array.isArray(diagnostic.data.fixes)) {
        for (let kind of diagnostic.data.fixes) {
          let qf = findQuickFixByKind(kind)
          if (qf) {
            actions.push(qf.convertToCodeAction(document.uri, tree, diagnostic))
          }
        }
      }
    }
    return actions
  })

  trees.onParseDone(event => {
    depsIndex.invalidateCache(event.document.uri)
    diagnosticsProvider.provideDiagnostics(event.document, event.tree).catch(console.error)
  })

  console.log('Tolk language server is READY');

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      codeActionProvider: true,
      documentSymbolProvider: true,
      definitionProvider: true,
      renameProvider: true,
      hoverProvider: true,
      documentFormattingProvider: true,
      completionProvider: {
        triggerCharacters: ['.']
      },
    }
  }
})

connection.onInitialized(() => {
  for (let handler of lspHandlers) {
    handler.register(connection);
  }
})

parseArgs();
connection.listen();
