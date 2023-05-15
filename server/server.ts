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
    SemanticTokens,
    DocumentHighlight,
    DocumentSymbol,
    DocumentSymbolRequest,
    SymbolInformation,
    DocumentSymbolParams,
    SemanticTokensBuilder,
} from 'vscode-languageserver/node';

import {
    TextDocument
} from 'vscode-languageserver-textdocument';

import { URI } from 'vscode-uri';

import { tokenize } from "infinite-lang/core/tokenizer";
import { TokenizeRuleModule } from 'infinite-lang/rule/tokenizer';

import { Node, parse } from "infinite-lang/core/parser";
import { ParseRuleModule } from 'infinite-lang/rule/parser';

import { getModules, getSymbolKind } from './util';
import { constants } from 'buffer';

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
        }
        else {
            console.warn(`Unknown file changed: ${change.uri}`);
        }
    });
});

connection.onRequest(DocumentSymbolRequest.type, handler => {
    const symbols: SymbolInformation[] = [];
    const document = documents.get(handler.textDocument.uri);

    if (!document) {
        console.warn(`Document not found: ${handler.textDocument.uri}`);
    }

    const tokens = tokenize({
        fileName: handler.textDocument.uri,
        input: document.getText(),
    }, tokenizerModules);

    symbols.push(...tokens.unwrap()
        .filter(token => token.highlight)
        .map(token => ({
            kind: getSymbolKind(token.highlight),
            location: {
                range: {
                    start: document.positionAt(token.startPos),
                    end: document.positionAt(token.endPos),
                },
                uri: handler.textDocument.uri,
            },
            name: token.tokenType,
        } as SymbolInformation)));

    console.log(symbols);

    return symbols;
});

connection.onRequest("textDocument/semanticTokens", (handler: DocumentSymbolParams): SemanticTokens => {
    const document = documents.get(handler.textDocument.uri);
    
    const semanticTokensMap: Map<string, {
        line: number;
        character: number;
        kind: number;
    }> = new Map();
    const builder = new SemanticTokensBuilder();

    if (!document) {
        console.warn(`Document not found: ${handler.textDocument.uri}`);
    }

    console.log(document.getText());

    const tokens = tokenize({
        fileName: handler.textDocument.uri,
        input: document.getText(),
    }, tokenizerModules);

    tokens.unwrap()
        .filter(token => token.highlight)
        .forEach(token => {
            const startPos = document.positionAt(token.startPos);

            semanticTokensMap.set(JSON.stringify([token.startPos, token.endPos]), {
                line: startPos.line,
                character: startPos.character,
                kind: getSymbolKind(token.highlight),
            });
        });

    const ast = parse({
        fileName: handler.textDocument.uri,
        tokens: tokens.unwrap(),
    }, parserModules, () => {});

    function travel(node: Node | Node[]) {
        if (Array.isArray(node)) {
            node.forEach(travel);

            return;
        }

        if (node.semanticHighlight) {
            const startPos = document.positionAt(node.startPos);

            semanticTokensMap.set(JSON.stringify([node.startPos, node.endPos]), {
                line: startPos.line,
                character: startPos.character,
                kind: getSymbolKind(node.semanticHighlight),
            });

            console.log(semanticTokensMap.get(JSON.stringify([node.startPos, node.endPos])));
        }

        if (node.children) {
            node.children.forEach(travel);
        }
    }

    ast.is_ok() && travel(ast.unwrap());

    semanticTokensMap.forEach((value, key) => {
        const [startPos, endPos] = JSON.parse(key) as [number, number];
        builder.push(value.line, value.character, endPos - startPos, value.kind, 0);
    });
    const result = builder.build();

    return result;
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