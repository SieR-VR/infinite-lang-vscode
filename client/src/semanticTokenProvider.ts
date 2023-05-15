import * as vscode from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';

const tokenTypes = [
    'namespace',
    'class',
    'enum',
    'interface',
    'struct',
    'typeParameter',
    'type',
    'parameter',
    'variable',
    'property',
    'enumMember',
    'decorator',
    'event',
    'function',
    'method',
    'macro',
    'label',
    'comment',
    'string',
    'keyword',
    'number',
    'regexp',
    'operator'
];

const tokenModifiers = [
    'declaration',
    'definition',
    'readonly',
    'static',
    'deprecated',
    'abstract',
    'async',
    'modification',
    'documentation',
    'defaultLibrary'
];

export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

export const makeProvider: (client: LanguageClient) => vscode.DocumentSemanticTokensProvider = (client) => ({
    provideDocumentSemanticTokens(document, cancellation) {
        return client.sendRequest(
            'textDocument/semanticTokens', 
            { textDocument: { uri: document.uri.toString() } }, 
            cancellation
        )
    },
});