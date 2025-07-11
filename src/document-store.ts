import { TextDecoder } from 'util';
import * as lsp from 'vscode-languageserver';
import { TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LRUMap } from './utils/lruMap';
import { URI, Utils} from 'vscode-uri';
import { NotificationFromClient, RequestFromServer } from "./shared-msgtypes";
import * as fs from 'fs/promises';
import { TolkCompilerSDK } from './config-scheme';

export interface TextDocumentChange2 {
  document: TextDocument,
  changes: {
    range: lsp.Range;
    rangeOffset: number;
    rangeLength: number;
    text: string;
  }[]
}

export class DocumentStore extends TextDocuments<TextDocument> {

  private readonly _onDidChangeContent2 = new lsp.Emitter<TextDocumentChange2>();
  readonly onDidChangeContent2 = this._onDidChangeContent2.event;

  private readonly _decoder = new TextDecoder();
  private readonly _fileDocuments: LRUMap<string, Promise<TextDocument | undefined>>;

  constructor(private readonly _connection: lsp.Connection, private readonly _compilerVersion: number, private readonly _readFileSupported: boolean) {
    super({
      create: TextDocument.create,
      update: (doc, changes, version) => {
        let result: TextDocument;
        let incremental = true;
        let event: TextDocumentChange2 = { document: doc, changes: [] };

        for (const change of changes) {
          if (!lsp.TextDocumentContentChangeEvent.isIncremental(change)) {
            incremental = false;
            break;
          }
          const rangeOffset = doc.offsetAt(change.range.start);
          event.changes.push({
            text: change.text,
            range: change.range,
            rangeOffset,
            rangeLength: change.rangeLength ?? doc.offsetAt(change.range.end) - rangeOffset,
          });
        }
        result = TextDocument.update(doc, changes, version);
        if (incremental) {
          this._onDidChangeContent2.fire(event);
        }
        return result;
      }
    });

    this._fileDocuments = new LRUMap<string, Promise<TextDocument | undefined>>({
      size: 200,
      dispose: _entries => {
      }
    });

    super.listen(_connection);

    _connection.onNotification(NotificationFromClient.removeFileFromFileCache, uri => this._fileDocuments.delete(uri));
  }

  add(documentUri: string, doc: Promise<TextDocument>) {
      this._fileDocuments.set(documentUri, doc);
  }
  async retrieveLocal(documentUri: string, langId: string, version: number) {
    let docData: string | undefined;
    let fetchRes = this._fileDocuments.get(documentUri);
    if(fetchRes) {
      return fetchRes;
    }

    try {
      // this._connection.sendNotification(`Document uri: ${documentUri}`);
      const filePath = URI.parse(documentUri).fsPath
      // this._connection.sendNotification(`Reading ${filePath}`);
      docData = await fs.readFile(filePath, {encoding: 'utf-8'});
    } catch (e) {
      console.error(e);
      return undefined;
    }

    const doc = TextDocument.create(documentUri, langId, version, docData);
    this._fileDocuments.set(documentUri, Promise.resolve(doc));

    return doc;
  }
  async retrieve(documentUri: string): Promise<TextDocument | undefined> {
    // this._connection.sendNotification(`Trying to retrieve ${documentUri}`);
    // const stack = new Error().stack;
    // this._connection.sendNotification(`Retrieve called at: ${stack?.toString()}`);
    let result = this.get(documentUri)
    if (result) {
      return result;
    }
    let promise = this._fileDocuments.get(documentUri);
    if (!promise) {
      promise = this._requestDocument(documentUri);
      this._fileDocuments.set(documentUri, promise);
    }
    return promise;
  }

  private async _requestDocument(uri: string): Promise<TextDocument | undefined> {
    if(this._readFileSupported) {
        const reply = await this._connection.sendRequest<{ type: 'Buffer', data: any } | { type: 'not-found' }>(RequestFromServer.fileReadContents, uri);
        if (reply.type === 'not-found') {
          return undefined;
        }
        let decoded = this._decoder.decode(new Uint8Array(reply.data));
        return TextDocument.create(uri, 'tolk', Number(this._compilerVersion), decoded);
    }
    return await this.retrieveLocal(uri, "tolk", 1);
  }
}
