import * as path from "path";
import { glob } from "glob";

import { SymbolKind } from "vscode-languageserver/node";
import type { HighlightTokenTypes } from "infinite-lang/rule/tokenizer";

export function getModules<T = any>(baseUrl: string, files: string[]): T[] {
    const modules = glob.sync(files, {
        cwd: baseUrl,
        ignore: [
            "node_modules/**",
        ]
    }).flat();

    return modules.map(module => require(path.join(baseUrl, module)).default)
        .filter(module => module);
}

export function getSymbolKind(s: HighlightTokenTypes): SymbolKind {
    switch(s) {
        case "string":
            return SymbolKind.String;
        case "number":
            return SymbolKind.Number;
        case "function":
            return SymbolKind.Function;
        case "namespace":
            return SymbolKind.Namespace;
        case "class":
            return SymbolKind.Class;
        case "enum":
            return SymbolKind.Enum;
        case "interface":
            return SymbolKind.Interface;
        case "struct":
            return SymbolKind.Struct;
        case "typeParameter":
            return SymbolKind.TypeParameter;
        case "type":
            return SymbolKind.Interface;
        case "parameter":
            return SymbolKind.Variable;
        case "variable":
            return SymbolKind.Variable;
        case "property":
            return SymbolKind.Property;
        case "enumMember":
            return SymbolKind.EnumMember;
        case "decorator":
            return SymbolKind.Property;
        case "event":
            return SymbolKind.Event;
        case "method":
            return SymbolKind.Method;
        case "macro":
            return SymbolKind.Function;
        case "label":
            return SymbolKind.Variable;
        case "comment":
            return SymbolKind.Variable;
        case "keyword":
            return SymbolKind.Key;
        case "regexp":
            return SymbolKind.Variable;
        case "operator":
            return SymbolKind.Operator;
    }
}
