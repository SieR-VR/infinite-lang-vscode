import * as path from 'path';

import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import { tokenize, TokenizerOptions } from "infinite-lang/core/tokenizer";
import { parse, ParserOptions } from "infinite-lang/core/parser";

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

interface InfiniteConfig {
    modules: string[];
}

let infconfig: InfiniteConfig = {
    modules: []
};

let tokenizerOptions: TokenizerOptions = { modules: [] };
let parserOptions: ParserOptions = { modules: [] };

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true
            }
        }
    };

    return result;
});

connection.onInitialized(() => {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
});

connection.onDidChangeWatchedFiles(handler => {
    handler.changes.forEach(async change => {
        const configDocument = change.uri.endsWith("infconfig.json") && documents.get(change.uri);
        if (configDocument) {
            const configPath = path.dirname(configDocument.uri);
            infconfig = JSON.parse(configDocument.getText());
            
            const modules = await Promise.all(infconfig.modules.map(async module => {
                return await import(path.join(configPath, module));
            }));
        }
    });
})

documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];

    try {
        const tokens = tokenize({
            fileName: textDocument.uri,
            input: text
        }, tokenizerOptions);

        const ast = parse({
            fileName: textDocument.uri,
            tokens
        }, parserOptions);
    }
    catch (error) {
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(error.start),
                end: textDocument.positionAt(error.end)
            },
            message: error.message,
            source: 'infinite'
        };
        diagnostics.push(diagnostic);
    }

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

documents.listen(connection);
connection.listen();