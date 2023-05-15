import * as path from "path";
import { workspace, ExtensionContext, languages } from "vscode";

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

import { makeProvider, legend } from "./semanticTokenProvider";

let client: LanguageClient;

export function activate(context: ExtensionContext) {
    const serverModule = context.asAbsolutePath(
        path.join("out", "server", "server.js")
    );

    console.log(serverModule);

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: "file", language: "infinite" }],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher("**/infconfig.json"),
        }
    };

    client = new LanguageClient(
        "infinite",
        "Infinite Language Server",
        serverOptions,
        clientOptions
    );

    client.start();

    languages.registerDocumentSemanticTokensProvider(
        { scheme: "file", language: "infinite" },
        makeProvider(client),
        legend
    );
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}