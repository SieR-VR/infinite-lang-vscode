import * as fs from 'fs';
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
    InitializeResult,
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import { URI } from 'vscode-uri';

import { tokenize } from "infinite-lang/core/tokenizer";
import { TokenizeRuleModule } from 'infinite-lang/rule/tokenizer';

import { Node, parse } from "infinite-lang/core/parser";
import { ParseRuleModule } from 'infinite-lang/rule/parser';

import { getModules } from './util';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

interface InfiniteConfig {
    token?: string;
    parser: string[];
}

let infconfig: InfiniteConfig = {
    token: undefined,
    parser: []
};

let tokenizerModules: TokenizeRuleModule[] = [];
let parserModules: ParseRuleModule<any, Node, string>[] = [];

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
        console.log(`File changed: ${change.uri}`);

        const configDocument = change.uri.endsWith("infconfig.json") 
            && URI.parse(change.uri).scheme === "file" 
                ? fs.readFileSync(URI.parse(change.uri).fsPath, { encoding: "utf-8" }) 
                : undefined;

        if (configDocument) {
            console.log(URI.parse(change.uri).fsPath)

            const configPath = path.dirname(URI.parse(change.uri).fsPath);
            infconfig = JSON.parse(configDocument);
            
            tokenizerModules = getModules<TokenizeRuleModule>(configPath, infconfig.token ? [infconfig.token] : [])
                .flat();
            parserModules = getModules<ParseRuleModule<any, Node, string>>(configPath, infconfig.parser);

            console.log(parserModules)
        }
        else {
            console.warn(`Unknown file changed: ${change.uri}`);
        }
    });
})

documents.onDidChangeContent(change => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];

    console.log(`start validating ${textDocument.uri} with \n\t${tokenizerModules.length} tokenizer modules and\n\t${parserModules.length} parser modules`);

    const tokens = tokenize({
        fileName: textDocument.uri,
        input: text
    }, tokenizerModules);

    if (tokens.is_err()) {
        const errors = tokens.unwrap_err();

        diagnostics.push(...errors.map(error => ({
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(error.startPos),
                end: textDocument.positionAt(error.endPos)
            },
            message: "Unknown token: " + textDocument.getText({
                start: textDocument.positionAt(error.startPos),
                end: textDocument.positionAt(error.endPos)
            }),
        })));

        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
        return;
    }

    const ast = parse({
        fileName: textDocument.uri,
        tokens: tokens.unwrap(),
    }, parserModules, () => {});

    if (ast.is_err()) {
        const errors = ast.unwrap_err();

        diagnostics.push(...errors.map(error => ({
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(error.startPos),
                end: textDocument.positionAt(error.endPos)
            },
            message: `Expected ${error.expected}, but found ${error.actual}:\n\tTried:\n${error.tried?.map(t => `\t\t${t}`).join("\n")}`,
        })));

        connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
        return;
    }

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

documents.listen(connection);
connection.listen();