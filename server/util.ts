import * as path from "path";
import { glob } from "glob";

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

