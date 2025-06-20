# Tolk LSP server

It's a an attempt to separate LSP server from [tolk-vscode](https://github.com/ton-blockchain/tolk-vscode)
into separate component.

## Build
- `npm run build`
- `npm pack`

## Install

Usually you need to install package globally
to be able to access it from the editor of choice.

``` shell
npm i -g <your resulting archive>
```

## Usage

After that point the server script
in your editor configuration.

### Helix

```
[language-server.tolk-lsp]

command = "/home/dev/.local/bin/tolk-lsp"
args = [
"--stdio",
"--tree-sitter-wasm=/home/dev/tolk-lsp/node_modules/web-tree-sitter/tree-sitter.wasm",
"--tree-sitter-tolk=/home/dev/tolk-lsp/tree-sitter-tolk.wasm"
]
file-types=["tolk"]

[[language]]

name = "tolk"
language-servers = ["tolk-lsp"]
scope = "source.mylang"
file-types=["tolk"]

```

## Gotchas

### Raw wasm binary ahead

`tree-sitter-tolk.wasm` is taken from [tolk-vscode](https://github.com/ton-blockchain/tolk-vscode/blob/master/server/tree-sitter-tolk.wasm)
Please at least verify checksum, or build your own.

You can also direct lsp to work with tree-sitter wasm blobs at arbitrary path,
as in example above

### Bundled tolk sdk

tolk-vscode extension supports custom request types such as:
- detectTolkSdk
- readFile

Any other editors do not support that functionality.
As a workaround, lsp would pick up sdk from bundled [tolk-js](https://github.com/ton-blockchain/tolk-js).
Which is not great, but OK for most use cases.

If you really need to specify other SDK, pass `--tolk-sdk-path=[my stdlib path]` as command argument.

### Under development

tolk-vscode is under development, we promise to improve LSP experience as soon as
everythin is settled with the compiler itself.
