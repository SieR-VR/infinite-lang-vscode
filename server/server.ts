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

import { getModules, getSymbolKind, getInfconfigFromPath, infconfigApplyGlob } from './util';
import { ModulePathManager } from './ModulePathManager';
import { InfiniteConfig } from './InfiniteConfig';

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

const InfiniteConfigManager = new ModulePathManager<InfiniteConfig>();
const TokenizerModuleManager = new ModulePathManager<TokenizeRuleModule[]>();
const ParserModuleManager = new ModulePathManager<ParseRuleModule<any, Node, string>>();

connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    console.log(params.workspaceFolders);
    
    params.workspaceFolders && params.workspaceFolders.forEach(folder => {
        const configs = getInfconfigFromPath(URI.parse(folder.uri).fsPath);
        configs.forEach(({ prefix, config }) => {
            InfiniteConfigManager.set(prefix, config);
            console.log(config);

            getModules<TokenizeRuleModule[]>(prefix, config.token ? config.token : []).map(module => {
                TokenizerModuleManager.set(module.file, module.module);
            });
            
            getModules<ParseRuleModule<any, Node, string>>(prefix, config.parser).map(module => {
                ParserModuleManager.set(module.file, module.module);
            });
        });
    });

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
            const configPath = path.dirname(URI.parse(change.uri).fsPath);
            const config = JSON.parse(configDocument) as InfiniteConfig;

            InfiniteConfigManager.set(configPath, JSON.parse(configDocument));

            getModules<TokenizeRuleModule[]>(configPath, config.token ? config.token : []).map(module => {
                TokenizerModuleManager.set(module.file, module.module);
            });
            
            getModules<ParseRuleModule<any, Node, string>>(configPath, config.parser).map(module => {
                ParserModuleManager.set(module.file, module.module);
            });
        }
        else {
            console.warn(`Unknown file changed: ${change.uri}`);
        }
    });
});

connection.onRequest("textDocument/semanticTokens", (handler: DocumentSymbolParams): SemanticTokens => {
    const semanticTokensMap: Map<string, {
        line: number;
        character: number;
        kind: number;
    }> = new Map();
    const document = documents.get(handler.textDocument.uri);

    if (!document) {
        console.warn(`Document not found: ${handler.textDocument.uri}`);
        return;
    }

    const directory = path.dirname(URI.parse(handler.textDocument.uri).fsPath);
    const config = InfiniteConfigManager.search(directory);

    if (!config) {
        console.warn(`Config not found: ${directory}`);
        return;
    }

    config.module = infconfigApplyGlob(config.path, config.module);

    const tokenizerModules = config.module.token
        .flatMap(module => TokenizerModuleManager.get(path.join(config.path, module)))
        .filter(module => module);
    const parserModules = config.module.parser
        .map(module => ParserModuleManager.get(path.join(config.path, module)))
        .filter(module => module);

    console.log(`start tokenizing ${handler.textDocument.uri} with \n\t${tokenizerModules.length} tokenizer modules and\n\t${parserModules.length} parser modules`);
    
    const tokens = tokenize({
        fileName: handler.textDocument.uri,
        input: document.getText(),
    }, tokenizerModules);

    if (tokens.is_err()) {
        console.warn(`Tokenize failed: ${tokens.unwrap_err()}`);
        return;
    }

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

    if (ast.is_err()) {
        console.warn(`Parse failed: ${ast.unwrap_err()}`);
        return;
    }

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
    travel(ast.unwrap());

    const builder = new SemanticTokensBuilder();
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

    const directory = path.dirname(URI.parse(textDocument.uri).fsPath);
    const config = InfiniteConfigManager.search(directory);

    if (!config) {
        console.warn(`Config not found: ${directory}`);
        return;
    }

    config.module = infconfigApplyGlob(config.path, config.module);

    const tokenizerModules = config.module.token
        .flatMap(module => TokenizerModuleManager.get(path.join(config.path, module)))
        .filter(module => module);
    const parserModules = config.module.parser
        .map(module => ParserModuleManager.get(path.join(config.path, module)))
        .filter(module => module);

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