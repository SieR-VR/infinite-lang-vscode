import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

import { SymbolKind } from "vscode-languageserver/node";
import type { HighlightTokenType } from "infinite-lang/rule/tokenizer";

import type { InfiniteConfig } from "./InfiniteConfig";

export function getModules<T = any>(baseUrl: string, files: string[]): { file: string, module: T }[] {
    const globbedFiles = glob.sync(files, {
        cwd: baseUrl,
        ignore: [
            "node_modules/**",
        ]
    }).flat();
    
    return globbedFiles.map(file => ({ 
        file: path.join(baseUrl, file), 
        module: require(path.join(baseUrl, file)).default as T 
    })).filter(module => module.module);
}

export function getInfconfigFromPath(filePath: string): { prefix: string, config: InfiniteConfig }[] {
    const configPaths = glob.sync("./**/infconfig.json", {
        cwd: filePath,
        ignore: [
            "node_modules/**",
        ]
    }).flat();

    return configPaths.map(configPath => {
        const config = fs.readFileSync(path.join(filePath, configPath), 'utf8');
        const prefix = path.dirname(path.join(filePath, configPath));
        return {
            prefix,
            config: JSON.parse(config)
        };
    }).filter(config => config);
}

export function infconfigApplyGlob(prefix: string, config: InfiniteConfig): InfiniteConfig {
    return {
        ...config,
        token: config.token ? glob.sync(config.token, {
            cwd: prefix,
            ignore: [
                "node_modules/**",
            ]
        }).flat() : undefined,
        parser: config.parser ? glob.sync(config.parser, {
            cwd: prefix,
            ignore: [
                "node_modules/**",
            ]
        }).flat() : undefined
    };
}

export function getSymbolKind(s: HighlightTokenType): SymbolKind {
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
